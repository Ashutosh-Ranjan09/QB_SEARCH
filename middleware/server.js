const express = require('express');
const axios = require('axios');
const redis = require('redis');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());          // allow Next.js frontend (and any origin) in dev
app.use(express.json());

// ---------------------------------------------------------------------------
// Config  (move to .env in production)
// ---------------------------------------------------------------------------
const ADMIN_SECRET = 'super_secret_uber_key';
const ADMIN_PASSWORD = 'admin';

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------
const redisClient = redis.createClient();
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

// ---------------------------------------------------------------------------
// Solr
// ---------------------------------------------------------------------------
const SOLR_NODES = [
    'http://localhost:8983/solr/qb_collection',
    'http://localhost:8984/solr/qb_collection',
];
const SOLR_UPDATE_URL = 'http://localhost:8983/solr/qb_collection/update?commit=true';

/** Pick a random Solr node for read load-balancing. */
function solrNode() {
    return SOLR_NODES[Math.floor(Math.random() * SOLR_NODES.length)];
}

// ---------------------------------------------------------------------------
// Query-analysis helpers  (ported from the Next.js search route)
// ---------------------------------------------------------------------------

/**
 * Inspect the raw query and return hints that drive field boosting
 * and query-rewriting decisions.
 */
function analyzeQuery(q) {
    const trimmed = q.trim();
    const isWildcard = trimmed === '*' || trimmed === '*:*';
    const terms = trimmed.split(/\s+/).filter(Boolean);
    const termCount = terms.length;

    // Two+ consecutive Title-Case words → likely an author name
    const looksLikeAuthor = /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)+$/.test(trimmed);

    // arXiv-style category tokens anywhere in the query
    const categoryTokens =
        trimmed.match(/\b(?:cs|math|stat|eess|q-bio|quant-ph)\.[A-Z]{2,4}\b/g) ?? [];

    return { isWildcard, termCount, looksLikeAuthor, categoryTokens };
}

/**
 * Build a URLSearchParams-compatible params object for an eDisMax search.
 */
function buildSearchParams(rawQuery, hints, rows, start, category, sort) {
    const { isWildcard, termCount, looksLikeAuthor, categoryTokens } = hints;

    // ── 1. Field boosting (qf) ────────────────────────────────────────────
    const authorBoost = looksLikeAuthor ? 8 : 1.5;
    const qf = [
        'title^6',
        'abstract^3',
        `authors^${authorBoost}`,
        'categories^1.5',
        'title_ngram^2',     // edge n-gram: partial words match full words
        'abstract_ngram^1',
    ].join(' ');

    // ── 2. Phrase boosting (pf / pf2 / pf3) ──────────────────────────────
    const pf = 'title^18 abstract^9';
    const pf2 = 'title^10 abstract^5';
    const pf3 = 'title^6  abstract^3';

    // ── 3. Phrase slop ────────────────────────────────────────────────────
    const ps = '3';
    const ps2 = '2';
    const ps3 = '1';

    // ── 4. Minimum Should Match ───────────────────────────────────────────
    const singleWordRewrite = !isWildcard && termCount === 1 && rawQuery.trim().length > 3;
    let mm;
    if (isWildcard) mm = '0%';
    else if (singleWordRewrite) mm = '1';    // OR across exact|prefix|fuzzy clauses
    else if (termCount <= 2) mm = '100%';
    else mm = '75%';

    // ── 5. Tie-breaker ────────────────────────────────────────────────────
    const tie = '0.1';

    // ── 6. Fuzzy / prefix expansion (single-word queries only) ───────────
    let finalQuery = rawQuery;
    if (singleWordRewrite) {
        const term = rawQuery.trim();
        // ~2 for long words (≥7 chars), ~1 for short words
        // Fuzzy distance tiers:
        //   1–3 chars → no fuzzy  (handled above: singleWordRewrite requires length > 3)
        //   4–6 chars → ~1        (1 edit: catches single typos on shorter words)
        //   7+  chars → ~2        (2 edits: tolerates more variation on longer words)
        // The 5s Solr timeout below ensures ~2 never hangs the request indefinitely.
        const fuzzyDistance = term.length >= 7 ? 2 : 1;
        finalQuery = `${term}^10 ${term}*^2 ${term}~${fuzzyDistance}`;
    }

    // ── 7. Boost query ────────────────────────────────────────────────────
    const bq = 'categories:cs.*^0.5';

    // ── 8. Filter queries ─────────────────────────────────────────────────
    const fqList = [];
    if (category) fqList.push(`categories:"${category}"`);
    for (const cat of categoryTokens) {
        const fqEntry = `categories:"${cat}"`;
        if (!fqList.includes(fqEntry)) fqList.push(fqEntry);
    }

    const params = {
        q: finalQuery,
        defType: 'edismax',
        qf, pf, pf2, pf3,
        ps, ps2, ps3,
        mm, tie, bq,
        fl: 'id,title,authors,categories,abstract,score',
        rows: String(rows),
        start: String(start),
        wt: 'json',
    };

    if (sort === 'title') params.sort = 'title asc';
    if (fqList.length) params.fq = fqList;  // axios sends arrays as repeated keys

    return { params, hints: { ...hints, singleWordRewrite } };
}

/** Normalise raw Solr docs into the shape the frontend expects. */
function normaliseDocs(docs) {
    return docs.map((doc) => ({
        id: String(doc.id ?? ''),
        title: Array.isArray(doc.title) ? doc.title[0] : String(doc.title ?? ''),
        authors: Array.isArray(doc.authors) ? doc.authors : doc.authors ? [String(doc.authors)] : [],
        categories: Array.isArray(doc.categories) ? doc.categories : doc.categories ? [String(doc.categories)] : [],
        abstract: Array.isArray(doc.abstract) ? doc.abstract[0] : doc.abstract ? String(doc.abstract) : '',
        score: typeof doc.score === 'number' ? doc.score : undefined,
    }));
}

// ===========================================================================
// PUBLIC ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/search  — full eDisMax search pipeline with Redis caching
// ---------------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
    try {
        const rawQuery = req.query.q || '*:*';
        const rows = parseInt(req.query.rows || '20', 10);
        const start = parseInt(req.query.start || '0', 10);
        const category = req.query.category || '';
        const sort = req.query.sort || 'relevance';

        // Cache key includes all query dimensions
        const cacheKey = `search:${rawQuery}:${rows}:${start}:${category}:${sort}`;

        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));

        const hints = analyzeQuery(rawQuery);
        const { params } = buildSearchParams(rawQuery, hints, rows, start, category, sort);

        const solrRes = await axios.get(`${solrNode()}/select`, {
            params,
            timeout: 5000,  // 5s — prevents hanging if Solr is slow
        });
        const data = solrRes.data;
        const docs = normaliseDocs(data.response?.docs ?? []);

        const payload = {
            numFound: data.response?.numFound ?? 0,
            start: data.response?.start ?? 0,
            rows,
            docs,
            _meta: {
                activeCategory: category || null,
                detectedCategories: hints.categoryTokens,
                looksLikeAuthor: hints.looksLikeAuthor,
            },
        };

        // Cache for 60 seconds
        await redisClient.setEx(cacheKey, 60, JSON.stringify(payload));

        res.status(200).json(payload);
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/suggest  — lightweight title autocomplete
// ---------------------------------------------------------------------------
app.get('/api/suggest', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();

        if (q.length < 2) return res.json({ suggestions: [] });

        const lastToken = q.split(/\s+/).pop() || q;
        const finalQ = lastToken.length >= 2 ? `${q} ${lastToken}*` : q;

        const solrRes = await axios.get(`${solrNode()}/select`, {
            params: {
                q: finalQ,
                defType: 'edismax',
                qf: 'title_ngram^3 title^6',
                pf: 'title^10',
                mm: '1',
                fl: 'title',
                rows: '8',
                wt: 'json',
            },
        });

        const docs = solrRes.data.response?.docs ?? [];
        const seen = new Set();
        const suggestions = [];

        for (const doc of docs) {
            const title = Array.isArray(doc.title) ? doc.title[0] : String(doc.title ?? '');
            if (title && !seen.has(title)) {
                seen.add(title);
                suggestions.push(title);
            }
            if (suggestions.length >= 8) break;
        }

        res.json({ suggestions });
    } catch (err) {
        console.error('Suggest error:', err.message);
        res.json({ suggestions: [] });
    }
});

// ---------------------------------------------------------------------------
// GET /api/papers  — list all indexed papers (public)
// ---------------------------------------------------------------------------
app.get('/api/papers', async (req, res) => {
    try {
        const solrRes = await axios.get(`${solrNode()}/select`, {
            params: {
                q: '*:*',
                rows: '1000',
                fl: 'id,title,authors,categories,abstract',
                wt: 'json',
            },
        });

        const data = solrRes.data;
        const docs = normaliseDocs(data.response?.docs ?? []);

        res.json({ numFound: data.response?.numFound ?? 0, docs });
    } catch (err) {
        console.error('Papers list error:', err.message);
        res.status(500).json({ error: 'Failed to list papers' });
    }
});

// ===========================================================================
// ADMIN AUTHENTICATION
// ===========================================================================
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, ADMIN_SECRET, { expiresIn: '1h' });
        res.status(200).json({ token });
    } else {
        res.status(401).json({ error: 'Unauthorized: Incorrect Password' });
    }
});

/** JWT guard middleware for protected routes. */
const verifyAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Forbidden: No token provided' });

    jwt.verify(token, ADMIN_SECRET, (err) => {
        if (err) return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
        next();
    });
};

// ===========================================================================
// ADMIN ROUTES  (require valid JWT)
// ===========================================================================

// POST /api/papers  — add a paper to Solr and invalidate Redis cache
app.post('/api/papers', verifyAdmin, async (req, res) => {
    try {
        const paper = req.body;

        if (!paper.title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const solrDoc = {
            id: paper.id || `QB-${Date.now()}`,
            title: paper.title,
            abstract: paper.abstract || '',
            authors: paper.authors ?? [],
            categories: paper.categories ?? [],
        };

        await axios.post(SOLR_UPDATE_URL, [solrDoc]);
        await redisClient.flushAll();   // invalidate cached search results

        res.status(200).json({ success: true, id: solrDoc.id });
    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(500).json({ error: 'Failed to upload to Solr' });
    }
});

// DELETE /api/papers/:id  — remove a paper and invalidate Redis cache
app.delete('/api/papers/:id', verifyAdmin, async (req, res) => {
    try {
        const paperId = req.params.id;

        await axios.post(SOLR_UPDATE_URL, { delete: { id: paperId } });
        await redisClient.flushAll();

        res.status(200).json({ success: true, id: paperId });
    } catch (err) {
        console.error('Delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete from Solr' });
    }
});

// ===========================================================================
// START
// ===========================================================================
app.listen(PORT, () => {
    console.log('\n=========================================');
    console.log('🚀 QuadBase API Gateway Online');
    console.log(`📡 Port: ${PORT}`);
    console.log('🔐 Admin Security: Active');
    console.log('🔍 Routes:');
    console.log('   GET  /api/search   — eDisMax + Redis cache');
    console.log('   GET  /api/suggest  — title autocomplete');
    console.log('   GET  /api/papers   — list all papers');
    console.log('   POST /api/login    — issue admin JWT');
    console.log('   POST /api/papers   — upload paper (JWT)');
    console.log('   DEL  /api/papers/:id — delete paper (JWT)');
    console.log('=========================================\n');
});