require('dotenv').config();

const db = require('./db-postgres');
const { startServer, app } = require('./server');
const auth = require('./auth');

const NETWORK = process.env.NETWORK || 'polygon';
const MINT_AMOUNT = process.env.MINT_AMOUNT || 2;

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║       KEA VALLEY® AUTO-MINTER          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`  Network:       ${NETWORK.toUpperCase()}`);
    console.log(`  Mint Amount:   ${MINT_AMOUNT} tokens`);
    console.log(`  Database:      PostgreSQL`);
    console.log('');

    // Initialize PostgreSQL database
    await db.initDb();
    console.log('✅ PostgreSQL database initialized');

    // Initialize admin user if not exists
    await auth.initializeAdmin();

    // Start API server
    await startServer();
}

// For Vercel serverless - initialize DB on cold start
let initialized = false;

async function initForVercel() {
    if (initialized) return;
    
    console.log('🔄 Initializing for Vercel...');
    
    try {
        // Initialize PostgreSQL database
        await db.initDb();
        console.log('✅ PostgreSQL database initialized');
        
        // Initialize admin user
        await auth.initializeAdmin();
        console.log('✅ Admin user initialized');
        
        initialized = true;
        console.log('✅ Vercel initialization complete');
    } catch (error) {
        console.error('❌ Vercel initialization error:', error);
        // Don't set initialized to true so it retries on next request
    }
}

// Initialize immediately for Vercel
if (process.env.VERCEL === '1') {
    initForVercel();
}

// For local development
if (process.env.VERCEL !== '1' && require.main === module) {
    main().catch(console.error);
}

// Export for Vercel serverless
module.exports = app;
