require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Use your Neon Postgres connection string (set in environment variable or hardcoded for now)
const PG_CONNECTION_STRING = process.env.PG_CONNECTION_STRING || 'YOUR_NEON_CONNECTION_STRING_HERE';
const pgPool = new Pool({ connectionString: PG_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });

// Ensure refresh_tokens table exists on startup
async function ensureSchema() {
    try {
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id          SERIAL PRIMARY KEY,
                admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
                token_hash  TEXT    NOT NULL UNIQUE,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        console.log('✓ refresh_tokens table ready');
    } catch (err) {
        console.error('Schema init error:', err.message);
    }
}
ensureSchema();

const app = express();
const PORT = 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());          // allow Next.js frontend (and any origin) in dev
app.use(express.json());

// ---------------------------------------------------------------------------
// Config  (Loaded via .env)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

// ---------------------------------------------------------------------------
// Solr
// ---------------------------------------------------------------------------
// Pass comma-separated URLs via SOLR_NODES env var
const solrNodesEnv = process.env.SOLR_NODES;
const SOLR_NODES = solrNodesEnv 
    ? solrNodesEnv.split(',').map(n => n.trim()) 
    : [
        'http://localhost:8983/solr/qb_collection',
        'http://localhost:8984/solr/qb_collection',
      ];

// Default to the first node in the array for the update URL if not explicitly provided
const SOLR_UPDATE_URL = process.env.SOLR_UPDATE_URL || `${SOLR_NODES[0]}/update?commit=true`;

/** 
 * Pick a Solr node using Round-Robin for perfect read load-balancing, 
 * with fallback retries to the next nodes if one goes down.
 */
let currentSolrNodeIndex = 0;

async function fetchFromSolr(endpoint, config) {
    const startIndex = currentSolrNodeIndex;
    // Advance round-robin index for the next request
    currentSolrNodeIndex = (currentSolrNodeIndex + 1) % SOLR_NODES.length;
    
    let lastError;
    // Attempt all nodes starting from the startIndex
    for (let i = 0; i < SOLR_NODES.length; i++) {
        const nodeIndex = (startIndex + i) % SOLR_NODES.length;
        const node = SOLR_NODES[nodeIndex];
        try {
            return await axios.get(`${node}${endpoint}`, config);
        } catch (err) {
            console.error(`Solr node ${node} failed. Trying next...`);
            lastError = err;
        }
    }
    throw lastError;
}

// ---------------------------------------------------------------------------
// Postgres Table Creation Endpoints (for one-time setup)
// ---------------------------------------------------------------------------
// NOTE: Remove or protect these endpoints after tables are created!

app.post('/api/init-db', async (req, res) => {
    try {
        // Admins table
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        // Papers table
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS papers (
                id VARCHAR(32) PRIMARY KEY,
                title TEXT NOT NULL,
                abstract TEXT,
                authors TEXT[],
                categories TEXT[],
                published TIMESTAMPTZ,
                updated TIMESTAMPTZ,
                pdf_url TEXT,
                abs_url TEXT
            );
        `);
        res.json({ success: true, message: 'Tables created or already exist.' });
    } catch (err) {
        console.error('DB init error:', err);
        res.status(500).json({ error: 'Failed to create tables', details: err.message });
    }
});

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
        'categories^1.5'
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
        fl: 'id,title,authors,categories,abstract,score,pdf_url,abs_url',
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
        pdf_url: Array.isArray(doc.pdf_url) ? doc.pdf_url[0] : doc.pdf_url ? String(doc.pdf_url) : '',
        abs_url: Array.isArray(doc.abs_url) ? doc.abs_url[0] : doc.abs_url ? String(doc.abs_url) : '',
    }));
}

// ===========================================================================
// HEALTH CHECK (used by Docker)
// ===========================================================================
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// ===========================================================================
// PUBLIC ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/health  — liveness probe for Docker / load-balancers
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// GET /api/search  — full eDisMax search pipeline with Redis caching
// ---------------------------------------------------------------------------

const searchLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests from this IP, please try again after a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const sanitizeQuery = (req, res, next) => {
    let q = req.query.q;
    if (!q) return next();

    // Rule 1: Length check buffer prevention
    if (q.length > 150) {
        return res.status(400).json({ error: 'Query string too long. Max 150 characters.' });
    }

    // Rule 2: Strip dangerous Lucene special characters to avoid massive recursive trees
    req.query.q = q.replace(/[\+\-\&\|\!\(\)\{\}\[\]\^\"\~\*\?\:\\]/g, ' ').trim();
    if (req.query.q.length === 0) {
        return res.status(400).json({ error: 'Invalid search query' });
    }
    
    next();
};

app.get('/api/search', searchLimiter, sanitizeQuery, async (req, res) => {
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

        const solrRes = await fetchFromSolr('/select', {
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

        const solrRes = await fetchFromSolr('/select', {
            params: {
                q: finalQ,
                defType: 'edismax',
                qf: 'title^6',
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
        const solrRes = await fetchFromSolr('/select', {
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
// Admin registration (one-time, or for new admins)
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        await pgPool.query(
            'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
            [username, hash]
        );
        res.status(201).json({ success: true, message: 'Admin registered' });
    } catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ error: 'Username already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed', details: err.message });
        }
    }
});

// Admin login (returns JWT)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    try {
        const result = await pgPool.query('SELECT * FROM admins WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        const admin = result.rows[0];
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        const secret = process.env.ADMIN_SECRET || 'your_jwt_secret_here';
        const refreshSecret = process.env.ADMIN_REFRESH_SECRET || 'your_refresh_secret_here';
        const token = jwt.sign({ role: 'admin', username: admin.username }, secret, { expiresIn: '24h' });
        const refreshToken = jwt.sign({ role: 'admin', username: admin.username }, refreshSecret, { expiresIn: '7d' });

        // Store refresh token hash in DB
        const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pgPool.query(
            'INSERT INTO refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [admin.id, tokenHash, expiresAt]
        );

        res.status(200).json({ token, refreshToken });
    } catch (err) {
        res.status(500).json({ error: 'Login failed', details: err.message });
    }
});

/** JWT guard middleware for protected routes. */
const verifyAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Forbidden: No token provided' });
    const secret = process.env.ADMIN_SECRET || 'your_jwt_secret_here';
    jwt.verify(token, secret, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
        req.user = decoded;
        next();
    });
};

// POST /api/refresh  — validate DB token, mint a new access token (token rotation)
app.post('/api/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    const refreshSecret = process.env.ADMIN_REFRESH_SECRET || 'your_refresh_secret_here';
    let user;
    try {
        user = jwt.verify(refreshToken, refreshSecret);
    } catch {
        return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    try {
        // Check token exists in DB and is not expired
        const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
        const result = await pgPool.query(
            'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
            [tokenHash]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Refresh token revoked or expired' });
        }

        // Rotate: delete old token, issue a new pair
        await pgPool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);

        const secret = process.env.ADMIN_SECRET || 'your_jwt_secret_here';
        const newAccessToken = jwt.sign({ role: user.role, username: user.username }, secret, { expiresIn: '24h' });
        const newRefreshToken = jwt.sign({ role: user.role, username: user.username }, refreshSecret, { expiresIn: '7d' });

        const adminResult = await pgPool.query('SELECT id FROM admins WHERE username = $1', [user.username]);
        const newTokenHash = require('crypto').createHash('sha256').update(newRefreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pgPool.query(
            'INSERT INTO refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [adminResult.rows[0].id, newTokenHash, expiresAt]
        );

        res.status(200).json({ token: newAccessToken, refreshToken: newRefreshToken });
    } catch (err) {
        res.status(500).json({ error: 'Token refresh failed', details: err.message });
    }
});

// POST /api/logout  — revoke the refresh token from DB
app.post('/api/logout', async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
        try {
            const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
            await pgPool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
        } catch (err) {
            console.error('Logout DB error:', err.message);
        }
    }
    res.status(200).json({ success: true });
});

// ===========================================================================
// ADMIN ROUTES  (require valid JWT)
// ===========================================================================

// PUT /api/admin/password  — change current admin password
app.put('/api/admin/password', verifyAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    
    try {
        const result = await pgPool.query('SELECT * FROM admins WHERE username = $1', [req.user.username]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
        
        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect current password' });
        
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);
        await pgPool.query('UPDATE admins SET password_hash = $1 WHERE username = $2', [hash, req.user.username]);

        // Invalidate all existing refresh tokens for this user
        await pgPool.query(
            'DELETE FROM refresh_tokens WHERE admin_id = (SELECT id FROM admins WHERE username = $1)',
            [req.user.username]
        );

        res.status(200).json({ success: true, message: 'Password updated. All sessions have been revoked.' });
    } catch (err) {
        console.error('Password change error:', err.message);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

// POST /api/papers  — add a paper to Postgres
app.post('/api/papers', verifyAdmin, async (req, res) => {
    try {
        const paper = req.body;
        if (!paper.title) {
            return res.status(400).json({ error: 'Title is required' });
        }
        const id = paper.id || `QB-${Date.now()}`;
        await pgPool.query(
            `INSERT INTO papers (id, title, abstract, authors, categories, published, updated, pdf_url, abs_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
               title=EXCLUDED.title, abstract=EXCLUDED.abstract, authors=EXCLUDED.authors, categories=EXCLUDED.categories, published=EXCLUDED.published, updated=EXCLUDED.updated, pdf_url=EXCLUDED.pdf_url, abs_url=EXCLUDED.abs_url`,
            [id, paper.title, paper.abstract || '', paper.authors || [], paper.categories || [], paper.published || null, paper.updated || null, paper.pdf_url || null, paper.abs_url || null]
        );
        
        // Sync to Solr
        await axios.post(SOLR_UPDATE_URL, [{
            id: id,
            title: paper.title,
            abstract: paper.abstract || '',
            authors: paper.authors || [],
            categories: paper.categories || [],
            pdf_url: paper.pdf_url || '',
            abs_url: paper.abs_url || ''
        }], { headers: { 'Content-Type': 'application/json' } });

        await redisClient.flushAll();   // invalidate cached search results
        res.status(200).json({ success: true, id });
    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(500).json({ error: 'Failed to upload to Postgres or Solr', details: err.message });
    }
});

// GET /api/papers  — list all papers (public)
app.get('/api/papers', async (req, res) => {
    try {
        const result = await pgPool.query('SELECT * FROM papers ORDER BY published DESC NULLS LAST, id DESC LIMIT 1000');
        res.json({ numFound: result.rowCount, docs: result.rows });
    } catch (err) {
        console.error('Papers list error:', err.message);
        res.status(500).json({ error: 'Failed to list papers', details: err.message });
    }
});

// PUT /api/papers/:id  — update a paper (admin)
app.put('/api/papers/:id', verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const paper = req.body;
        await pgPool.query(
            `UPDATE papers SET title=$1, abstract=$2, authors=$3, categories=$4, published=$5, updated=$6, pdf_url=$7, abs_url=$8 WHERE id=$9`,
            [paper.title, paper.abstract || '', paper.authors || [], paper.categories || [], paper.published || null, paper.updated || null, paper.pdf_url || null, paper.abs_url || null, id]
        );

        // Sync to Solr
        await axios.post(SOLR_UPDATE_URL, [{
            id: id,
            title: paper.title,
            abstract: paper.abstract || '',
            authors: paper.authors || [],
            categories: paper.categories || [],
            pdf_url: paper.pdf_url || '',
            abs_url: paper.abs_url || ''
        }], { headers: { 'Content-Type': 'application/json' } });

        await redisClient.flushAll();
        res.status(200).json({ success: true, id });
    } catch (err) {
        console.error('Update error:', err.message);
        res.status(500).json({ error: 'Failed to update paper', details: err.message });
    }
});

// DELETE /api/papers/:id  — remove a paper
app.delete('/api/papers/:id', verifyAdmin, async (req, res) => {
    try {
        const paperId = req.params.id;
        await pgPool.query('DELETE FROM papers WHERE id = $1', [paperId]);
        
        // Delete from Solr
        await axios.post(SOLR_UPDATE_URL, {
            delete: { id: paperId }
        }, { headers: { 'Content-Type': 'application/json' } });

        await redisClient.flushAll();
        res.status(200).json({ success: true, id: paperId });
    } catch (err) {
        console.error('Delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete from Postgres or Solr', details: err.message });
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