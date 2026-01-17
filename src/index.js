require('dotenv').config();

const { initDb } = require('./db');
const { startServer, app } = require('./server');
const auth = require('./auth');

const NETWORK = process.env.NETWORK || 'amoy';
const MINT_AMOUNT = process.env.MINT_AMOUNT || 2;

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║       KEA VALLEY® AUTO-MINTER          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`  Network:       ${NETWORK.toUpperCase()}`);
    console.log(`  Mint Amount:   ${MINT_AMOUNT} tokens`);
    console.log('');

    // Initialize database
    await initDb();
    console.log('✅ Database initialized');

    // Print first-run credentials if applicable
    auth.printFirstRunBanner();

    // Start API server
    await startServer();
}

// For Vercel serverless - initialize DB on cold start
let dbInitialized = false;

async function initForVercel() {
    if (!dbInitialized) {
        console.log('🔄 Initializing for Vercel...');
        await initDb();
        auth.initCredentials();
        dbInitialized = true;
        console.log('✅ Vercel initialization complete');
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
