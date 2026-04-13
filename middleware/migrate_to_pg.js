require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { Pool } = require('pg');

const PG_CONNECTION_STRING = process.env.PG_CONNECTION_STRING;

if (!PG_CONNECTION_STRING) {
    console.error("CRITICAL ERROR: PG_CONNECTION_STRING not found in .env");
    process.exit(1);
}

const pgPool = new Pool({ connectionString: PG_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });

// Read the bulk file and dispatch batches to PostgreSQL
async function processFile(filePath) {
    console.log(`\n--- Starting database migration for ${path.basename(filePath)} ---`);
    const fileStream = fs.createReadStream(filePath);
    
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let batch = [];
    const BATCH_SIZE = 500;
    let lineNum = 0;
    let totalMigrated = 0;

    for await (const line of rl) {
        lineNum++;
        if (!line.trim()) continue;

        try {
            const paper = JSON.parse(line);
            
            // Format dates neatly or use null
            const published = paper.published ? new Date(paper.published).toISOString() : null;
            const updated = paper.updated ? new Date(paper.updated).toISOString() : null;

            batch.push([
                paper.id || `unknown_id_${Date.now()}_${lineNum}`,
                paper.title || 'No Title Provided',
                paper.abstract || '',
                Array.isArray(paper.authors) ? paper.authors : (paper.authors ? [paper.authors] : ['Unknown Author']),
                Array.isArray(paper.categories) ? paper.categories : (paper.categories ? [paper.categories] : ['cs.UNKNOWN']),
                published,
                updated,
                paper.pdf_url || '',
                paper.abs_url || ''
            ]);

            if (batch.length >= BATCH_SIZE) {
                await insertBatch(batch);
                totalMigrated += batch.length;
                console.log(`Successfully migrated ${totalMigrated} papers from ${path.basename(filePath)} so far...`);
                batch = [];
            }
        } catch (err) {
            console.error(`Skipping invalid JSON format on line ${lineNum}`, err.message);
        }
    }

    if (batch.length > 0) {
        await insertBatch(batch);
        totalMigrated += batch.length;
        console.log(`Final batch migrated successfully from ${path.basename(filePath)}!`);
    }

    console.log(`\n✓ Finished ${path.basename(filePath)}! Total Database Records: ${totalMigrated}`);
}

async function insertBatch(batch) {
    if (batch.length === 0) return;

    // Use parameterized queries to handle bulk insert automatically translating JS arrays to Postgres []
    // Format: ($1, $2, $3, $4, $5, $6, $7, $8, $9), ($10, $11...
    const valuesList = [];
    let queryValues = [];
    let counter = 1;

    for (const record of batch) {
        const placeholders = [];
        for (let i = 0; i < 9; i++) {
            placeholders.push(`$${counter++}`);
        }
        valuesList.push(`(${placeholders.join(', ')})`);
        queryValues.push(...record);
    }

    const query = `
        INSERT INTO papers (id, title, abstract, authors, categories, published, updated, pdf_url, abs_url)
        VALUES ${valuesList.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            abstract = EXCLUDED.abstract,
            authors = EXCLUDED.authors,
            categories = EXCLUDED.categories,
            published = EXCLUDED.published,
            updated = EXCLUDED.updated,
            pdf_url = EXCLUDED.pdf_url,
            abs_url = EXCLUDED.abs_url;
    `;

    try {
        await pgPool.query(query, queryValues);
    } catch (err) {
        console.error("Error inserting batch. Sample record:", batch[0]);
        console.error("Database Error:", err.message);
        throw err;
    }
}

async function main() {
    try {
        console.log("Checking target Postgres database...");
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
        console.log("✓ 'papers' table structure is ready.");
        
        // These are the large jsonl datasets
        const filesToProcess = [
            "cs_ir_papers.jsonl", 
            "cs_ne_papers.jsonl", 
            "cs_ai_papers.jsonl", 
            "cs_cl_papers.jsonl", 
            "cs_cv_papers.jsonl", 
            "cs_lg_papers.jsonl"
        ];
        
        for (const file of filesToProcess) {
            const filePath = path.join(__dirname, '..', file);
            if (fs.existsSync(filePath)) {
                await processFile(filePath);
            } else {
                console.log(`Skipping ${file} - file not found.`);
            }
        }
        
        console.log("\n=================================");
        console.log("🎉 PostgeSQL Migration Complete!");
        console.log("=================================\n");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await pgPool.end();
    }
}

main();
