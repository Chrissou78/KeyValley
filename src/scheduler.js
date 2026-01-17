const cron = require('node-cron');
const db = require('./db');
const minter = require('./minter');
require('dotenv').config();

const MINT_AMOUNT = parseInt(process.env.MINT_AMOUNT) || 2;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MINUTES) || 30;
const BATCH_SIZE = 50; // Max addresses per transaction (gas limit safety)

async function processNewRegistrants() {
  const timestamp = new Date().toISOString();
  console.log(`\n⏰ [${timestamp}] Checking for new registrants...`);

  try {
    // Get unminted registrants from DB
    const pending = db.getUnmintedRegistrants();

    if (pending.length === 0) {
      console.log('   No new registrants to mint.');
      return;
    }

    console.log(`   Found ${pending.length} pending registrant(s) in database.`);

    // Deduplicate addresses
    const addressSet = new Set();
    const uniquePending = pending.filter(r => {
      const normalized = r.wallet_address.toLowerCase();
      if (addressSet.has(normalized)) {
        return false;
      }
      addressSet.add(normalized);
      return true;
    });

    // Process in batches
    for (let i = 0; i < uniquePending.length; i += BATCH_SIZE) {
      const batch = uniquePending.slice(i, i + BATCH_SIZE);
      const addresses = batch.map((r) => r.wallet_address);

      console.log(`\n   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniquePending.length / BATCH_SIZE)} (${addresses.length} addresses)`);

      try {
        // This will check on-chain balances and skip wallets that already have tokens
        const result = await minter.batchMintToAddresses(addresses, MINT_AMOUNT);

        if (result) {
          const network = process.env.NETWORK || 'amoy';

          // Mark successfully minted addresses
          if (result.mintedAddresses && result.mintedAddresses.length > 0) {
            for (const address of result.mintedAddresses) {
              const markResult = db.markAsMinted(address, result.receipt.hash, network);
              if (markResult.success) {
                console.log(`   ✓ Minted and marked: ${address}`);
              }
            }
          }

          // Mark skipped addresses (already have tokens) as minted too
          if (result.skippedAddresses && result.skippedAddresses.length > 0) {
            for (const address of result.skippedAddresses) {
              const markResult = db.markAsMinted(address, 'ALREADY_HAD_TOKENS', network);
              if (markResult.success) {
                console.log(`   ✓ Already had tokens, marked as complete: ${address}`);
              }
            }
          }
        }
      } catch (batchError) {
        console.error(`   ❌ Batch failed, falling back to individual mints:`, batchError.message);

        // Fallback: try individual mints
        for (const registrant of batch) {
          try {
            const result = await minter.mintToAddress(registrant.wallet_address, MINT_AMOUNT);
            const network = process.env.NETWORK || 'amoy';

            if (result.skipped) {
              // Already has tokens
              db.markAsMinted(registrant.wallet_address, 'ALREADY_HAD_TOKENS', network);
              console.log(`   ✓ Already had tokens, marked as complete: ${registrant.wallet_address}`);
            } else if (result.receipt) {
              db.markAsMinted(registrant.wallet_address, result.receipt.hash, network);
              console.log(`   ✓ Minted: ${registrant.wallet_address}`);
            }
          } catch (err) {
            console.error(`   ❌ Failed to mint to ${registrant.wallet_address}:`, err.message);
          }
        }
      }
    }

    console.log(`\n✅ Minting cycle complete.`);

  } catch (error) {
    console.error('❌ Error processing registrants:', error.message);
  }
}

// Sync database with on-chain state
async function syncWithChain() {
  console.log('\n🔄 Syncing database with on-chain state...');

  try {
    const pending = db.getUnmintedRegistrants();

    if (pending.length === 0) {
      console.log('   No pending registrants to sync.');
      return;
    }

    console.log(`   Checking ${pending.length} pending registrant(s) on-chain...`);

    const addresses = pending.map(r => r.wallet_address);
    const balanceCheck = await minter.checkBalances(addresses);

    if (balanceCheck.withTokens.length > 0) {
      console.log(`   Found ${balanceCheck.withTokens.length} wallet(s) that already have tokens.`);
      
      const network = process.env.NETWORK || 'amoy';
      for (const wallet of balanceCheck.withTokens) {
        db.markAsMinted(wallet.address, 'SYNCED_FROM_CHAIN', network);
        console.log(`   ✓ Synced: ${wallet.address} (balance: ${wallet.balance})`);
      }
    } else {
      console.log('   All pending wallets confirmed to have zero balance.');
    }

  } catch (error) {
    console.error('❌ Error syncing with chain:', error.message);
  }
}

function buildCronExpression(minutes) {
  if (minutes <= 0) {
    throw new Error('POLL_INTERVAL_MINUTES must be greater than 0');
  }

  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  } else {
    const days = Math.floor(minutes / 1440);
    return `0 0 */${days} * *`;
  }
}

function getNextRunTime(intervalMinutes) {
  const now = new Date();
  const nextRun = new Date(now.getTime() + intervalMinutes * 60 * 1000);
  return nextRun.toISOString();
}

async function startScheduler() {
  console.log('\n📅 Starting Auto-Minter Scheduler...');

  // Initialize minter (validates config)
  await minter.initialize();

  // Clean any existing duplicates
  const cleaned = db.cleanDuplicates();
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} duplicate entries from database`);
  }

  // Sync with on-chain state (mark wallets that already have tokens)
  await syncWithChain();

  // Show current stats
  const stats = db.getStats();
  console.log(`\n📊 Current stats:`);
  console.log(`   Total unique registrants: ${stats.total}`);
  console.log(`   Already minted: ${stats.minted}`);
  console.log(`   Pending: ${stats.pending}`);

  // Run immediately on start
  await processNewRegistrants();

  // Build cron expression from env
  const cronExpression = buildCronExpression(POLL_INTERVAL);

  // Schedule recurring job
  cron.schedule(cronExpression, processNewRegistrants);

  console.log(`\n📅 Scheduler running - checking every ${POLL_INTERVAL} minute(s)`);
  console.log(`   Cron expression: ${cronExpression}`);
  console.log(`   Next run: ~${getNextRunTime(POLL_INTERVAL)}`);
}

module.exports = { startScheduler, processNewRegistrants, syncWithChain };
