const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'registrants.db');

let db = null;

// Initialize database
async function initDb() {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize tables with UNIQUE constraint
  db.run(`
    CREATE TABLE IF NOT EXISTS registrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT UNIQUE NOT NULL COLLATE NOCASE,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      minted INTEGER DEFAULT 0,
      minted_at DATETIME,
      tx_hash TEXT,
      network TEXT
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_unique ON registrants(wallet_address COLLATE NOCASE)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_minted ON registrants(minted)`);

  // Save to disk
  saveDb();

  return db;
}

// Save database to disk
function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Ensure db is initialized before operations
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

// Normalize wallet address (lowercase, trim)
function normalizeAddress(address) {
  if (!address) return null;
  return address.toLowerCase().trim();
}

module.exports = {
  initDb,

  // Add new registrant - returns status
  addRegistrant(walletAddress) {
    const database = getDb();
    const normalized = normalizeAddress(walletAddress);
    
    if (!normalized) {
      return { success: false, error: 'Invalid address', changes: 0 };
    }

    // Check if already exists
    if (this.walletExists(normalized)) {
      return { success: false, error: 'Wallet already registered', changes: 0, duplicate: true };
    }

    try {
      database.run(
        `INSERT INTO registrants (wallet_address, registered_at) VALUES (?, datetime('now'))`,
        [normalized]
      );
      saveDb();
      return { success: true, changes: database.getRowsModified() };
    } catch (err) {
      // Handle unique constraint violation
      if (err.message.includes('UNIQUE constraint failed')) {
        return { success: false, error: 'Wallet already registered', changes: 0, duplicate: true };
      }
      console.error('Error adding registrant:', err);
      return { success: false, error: err.message, changes: 0 };
    }
  },

  // Bulk add registrants - skips duplicates and returns report
  addRegistrantsBulk(walletAddresses) {
    const database = getDb();
    const results = {
      total: walletAddresses.length,
      added: 0,
      duplicates: 0,
      invalid: 0,
      errors: [],
    };

    // Normalize and deduplicate input
    const uniqueAddresses = [...new Set(walletAddresses.map(normalizeAddress).filter(Boolean))];
    results.invalid = walletAddresses.length - walletAddresses.filter(Boolean).length;

    for (const address of uniqueAddresses) {
      const result = this.addRegistrant(address);
      if (result.success) {
        results.added++;
      } else if (result.duplicate) {
        results.duplicates++;
      } else {
        results.errors.push({ address, error: result.error });
      }
    }

    return results;
  },

  // Get all unminted registrants (guaranteed unique)
  getUnmintedRegistrants() {
    const database = getDb();
    const stmt = database.prepare(`
      SELECT DISTINCT wallet_address, id, registered_at, minted, minted_at, tx_hash, network 
      FROM registrants 
      WHERE minted = 0
      ORDER BY registered_at ASC
    `);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  // Mark as minted - with double-check
  markAsMinted(walletAddress, txHash, network) {
    const database = getDb();
    const normalized = normalizeAddress(walletAddress);

    // Double-check it's not already minted
    const existing = this.getRegistrant(normalized);
    if (existing && existing.minted) {
      console.warn(`Warning: Wallet ${normalized} already minted. Skipping.`);
      return { success: false, alreadyMinted: true, changes: 0 };
    }

    database.run(
      `UPDATE registrants 
       SET minted = 1, minted_at = datetime('now'), tx_hash = ?, network = ? 
       WHERE LOWER(wallet_address) = ? AND minted = 0`,
      [txHash, network, normalized]
    );
    saveDb();
    return { success: true, changes: database.getRowsModified() };
  },

  // Check if wallet exists
  walletExists(walletAddress) {
    const database = getDb();
    const normalized = normalizeAddress(walletAddress);
    const stmt = database.prepare(
      `SELECT 1 FROM registrants WHERE LOWER(wallet_address) = ?`
    );
    stmt.bind([normalized]);
    const exists = stmt.step();
    stmt.free();
    return exists;
  },

  // Check if wallet is already minted
  isWalletMinted(walletAddress) {
    const database = getDb();
    const normalized = normalizeAddress(walletAddress);
    const stmt = database.prepare(
      `SELECT minted FROM registrants WHERE LOWER(wallet_address) = ?`
    );
    stmt.bind([normalized]);
    if (stmt.step()) {
      const result = stmt.getAsObject();
      stmt.free();
      return result.minted === 1;
    }
    stmt.free();
    return false;
  },

  // Get single registrant
  getRegistrant(walletAddress) {
    const database = getDb();
    const normalized = normalizeAddress(walletAddress);
    const stmt = database.prepare(
      `SELECT * FROM registrants WHERE LOWER(wallet_address) = ?`
    );
    stmt.bind([normalized]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  },

  // Get all registrants
  getAllRegistrants() {
    const database = getDb();
    const stmt = database.prepare(`
      SELECT DISTINCT wallet_address, id, registered_at, minted, minted_at, tx_hash, network 
      FROM registrants 
      ORDER BY registered_at DESC
    `);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },

  // Get stats
  getStats() {
    const database = getDb();

    let stmt = database.prepare('SELECT COUNT(DISTINCT wallet_address) as count FROM registrants');
    stmt.step();
    const total = stmt.getAsObject().count;
    stmt.free();

    stmt = database.prepare('SELECT COUNT(DISTINCT wallet_address) as count FROM registrants WHERE minted = 1');
    stmt.step();
    const minted = stmt.getAsObject().count;
    stmt.free();

    stmt = database.prepare('SELECT COUNT(DISTINCT wallet_address) as count FROM registrants WHERE minted = 0');
    stmt.step();
    const pending = stmt.getAsObject().count;
    stmt.free();

    return { total, minted, pending };
  },

  // Clean duplicates (if any exist from before)
  cleanDuplicates() {
    const database = getDb();
    
    // Keep only the first registration for each wallet
    database.run(`
      DELETE FROM registrants 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM registrants 
        GROUP BY LOWER(wallet_address)
      )
    `);
    
    const removed = database.getRowsModified();
    if (removed > 0) {
      console.log(`Cleaned ${removed} duplicate entries`);
      saveDb();
    }
    return removed;
  },
};
