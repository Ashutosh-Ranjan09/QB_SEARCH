require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

const PG_CONNECTION_STRING = process.env.PG_CONNECTION_STRING;
if (!PG_CONNECTION_STRING) {
    console.error("CRITICAL ERROR: PG_CONNECTION_STRING not found in .env");
    process.exit(1);
}

// Fallbacks mapped perfectly from server.js
const solrNodesEnv = process.env.SOLR_NODES;
const SOLR_NODES = solrNodesEnv ? solrNodesEnv.split(',').map(n => n.trim()) : ['http://localhost:8983/solr/qb_collection'];
const SOLR_UPDATE_URL = process.env.SOLR_UPDATE_URL || `${SOLR_NODES[0]}/update?commit=true`;

const pgPool = new Pool({ connectionString: PG_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });

const BATCH_SIZE = 1000; // Pull chunks of a thousand rows per page to prevent V8 memory crashes

async function syncToSolr() {
    console.log(`\n======================================================`);
    console.log(`🚀 STARTING POSTGRES -> SOLR SYNCHRONIZATION`);
    console.log(`🔗 Target Solr Node: ${SOLR_UPDATE_URL}`);
    console.log(`======================================================\n`);

    // Verify DB
    try {
        await pgPool.query('SELECT 1 FROM papers LIMIT 1');
    } catch {
        console.error("🔥 Error: 'papers' table does not exist. Please run migrate_to_pg.js first!");
        process.exit(1);
    }

    let offset = 0;
    let totalSynced = 0;

    try {
        while (true) {
            // Retrieve page of records ordered securely
            const result = await pgPool.query(`SELECT * FROM papers ORDER BY id LIMIT $1 OFFSET $2`, [BATCH_SIZE, offset]);
            const rows = result.rows;

            if (rows.length === 0) {
                break; // No more rows left in the database.
            }

            // Shape standard SQL objects explicitly into the Solr JSON format
            const solrBatch = rows.map(paper => ({
                id: paper.id,
                title: paper.title,
                abstract: paper.abstract || '',
                authors: paper.authors || [],
                categories: paper.categories || [],
                pdf_url: paper.pdf_url || '',
                abs_url: paper.abs_url || ''
            }));

            // Send standard HTTP chunk directly to Solr
            await axios.post(SOLR_UPDATE_URL, solrBatch, { 
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 // Ensure connection doesn't hang forever
            });
            
            totalSynced += rows.length;
            offset += BATCH_SIZE;

            console.log(`Successfully chunked and indexed ${totalSynced} records to Solr...`);
        }

        console.log(`\n✅ Synchronization fully complete!`); 
        console.log(`Total Postgres Database Records Synced: ${totalSynced}`);
    } catch (err) {
        console.error("\n🔥 Synchronization explicitly failed:", err.message);
    } finally {
        await pgPool.end();
    }
}

// Fire sequence
syncToSolr();
