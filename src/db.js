const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let db = null;
const isVercel = process.env.VERCEL === '1';
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'registrants.db');

async function initDb() {
    const SQL = await initSqlJs();
    
    if (isVercel) {
        // Vercel: in-memory only (read-only filesystem)
        console.log('📦 Using in-memory database (Vercel serverless)');
        db = new SQL.Database();
    } else {
        // Local: persist to file
        try {
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            if (fs.existsSync(dbPath)) {
                const buffer = fs.readFileSync(dbPath);
                db = new SQL.Database(buffer);
                console.log('📦 Loaded existing database');
            } else {
                db = new SQL.Database();
                console.log('📦 Created new database');
            }
        } catch (error) {
            console.log('📦 Filesystem not available, using in-memory database');
            db = new SQL.Database();
        }
    }
    
    // Create tables
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
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_minted ON registrants(minted)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_unique ON registrants(wallet_address COLLATE NOCASE)`);
    
    if (!isVercel) {
        saveDb();
    }
    
    return db;
}

function saveDb() {
    if (db && !isVercel) {
        try {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        } catch (error) {
            console.log('Warning: Could not save database to disk');
        }
    }
}

function getDb() {
    return db;
}

function normalizeAddress(address) {
    return address.toLowerCase().trim();
}

function addRegistrant(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    
    try {
        const existing = db.exec(`SELECT id FROM registrants WHERE wallet_address = '${normalized}'`);
        if (existing.length > 0 && existing[0].values.length > 0) {
            return { success: false, duplicate: true };
        }
        
        db.run(`INSERT INTO registrants (wallet_address) VALUES ('${normalized}')`);
        if (!isVercel) saveDb();
        return { success: true };
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return { success: false, duplicate: true };
        }
        return { success: false, error: error.message };
    }
}

function getUnmintedRegistrants() {
    const result = db.exec(`SELECT * FROM registrants WHERE minted = 0 ORDER BY registered_at ASC`);
    if (result.length === 0) return [];
    
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}

function markAsMinted(walletAddress, txHash, network) {
    const normalized = normalizeAddress(walletAddress);
    db.run(`
        UPDATE registrants 
        SET minted = 1, minted_at = datetime('now'), tx_hash = '${txHash}', network = '${network}'
        WHERE wallet_address = '${normalized}'
    `);
    if (!isVercel) saveDb();
}

function walletExists(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    const result = db.exec(`SELECT id FROM registrants WHERE wallet_address = '${normalized}'`);
    return result.length > 0 && result[0].values.length > 0;
}

function isWalletMinted(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    const result = db.exec(`SELECT minted FROM registrants WHERE wallet_address = '${normalized}'`);
    if (result.length === 0 || result[0].values.length === 0) return false;
    return result[0].values[0][0] === 1;
}

function getRegistrant(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    const result = db.exec(`SELECT * FROM registrants WHERE wallet_address = '${normalized}'`);
    if (result.length === 0 || result[0].values.length === 0) return null;
    
    const columns = result[0].columns;
    const row = result[0].values[0];
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
}

function getAllRegistrants() {
    const result = db.exec(`SELECT * FROM registrants ORDER BY registered_at DESC`);
    if (result.length === 0) return [];
    
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}

function getStats() {
    const total = db.exec(`SELECT COUNT(*) FROM registrants`);
    const minted = db.exec(`SELECT COUNT(*) FROM registrants WHERE minted = 1`);
    const pending = db.exec(`SELECT COUNT(*) FROM registrants WHERE minted = 0`);
    
    return {
        total: total[0]?.values[0]?.[0] || 0,
        minted: minted[0]?.values[0]?.[0] || 0,
        pending: pending[0]?.values[0]?.[0] || 0
    };
}

module.exports = {
    initDb,
    getDb,
    addRegistrant,
    getUnmintedRegistrants,
    markAsMinted,
    walletExists,
    isWalletMinted,
    getRegistrant,
    getAllRegistrants,
    getStats
};
