require('dotenv').config();
const { initDb } = require('./db');
const { initializeCredentials } = require('./auth');
const { startServer } = require('./server');
const { startScheduler } = require('./scheduler');

const pollInterval = process.env.POLL_INTERVAL_MINUTES || 30;

console.log('═══════════════════════════════════════════════════════════');
console.log('                  AUTO-MINTER SERVICE');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Network:       ${process.env.NETWORK || 'amoy'}`);
console.log(`  Mint amount:   ${process.env.MINT_AMOUNT || 2} tokens`);
console.log(`  Poll interval: ${pollInterval} minutes`);
console.log('═══════════════════════════════════════════════════════════');

// Initialize everything
async function main() {
  // Initialize credentials (generates password on first run)
  initializeCredentials();

  // Initialize database
  await initDb();
  console.log('✅ Database initialized');

  // Start API server
  startServer();

  // Start scheduler
  await startScheduler();
}

main().catch((error) => {
  console.error('\n❌ Failed to start:', error.message);
  process.exit(1);
});
