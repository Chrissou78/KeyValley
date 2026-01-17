// Simple in-memory database for Vercel serverless
// Note: Data resets on cold start, but blockchain is source of truth

let db = {
    registrants: []
};

let initialized = false;

async function initDb() {
    if (initialized) return;
    
    console.log('📦 Using in-memory database');
    db = {
        registrants: []
    };
    initialized = true;
    
    return db;
}

function normalizeAddress(address) {
    return address.toLowerCase().trim();
}

function addRegistrant(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    
    // Check if already exists
    const existing = db.registrants.find(r => r.wallet_address === normalized);
    if (existing) {
        return { success: false, duplicate: true };
    }
    
    const registrant = {
        id: db.registrants.length + 1,
        wallet_address: normalized,
        registered_at: new Date().toISOString(),
        minted: 0,
        minted_at: null,
        tx_hash: null,
        network: null
    };
    
    db.registrants.push(registrant);
    console.log(`📝 Added registrant: ${normalized}`);
    
    return { success: true };
}

function getUnmintedRegistrants() {
    return db.registrants.filter(r => r.minted === 0);
}

function markAsMinted(walletAddress, txHash, network) {
    const normalized = normalizeAddress(walletAddress);
    const registrant = db.registrants.find(r => r.wallet_address === normalized);
    
    if (registrant) {
        registrant.minted = 1;
        registrant.minted_at = new Date().toISOString();
        registrant.tx_hash = txHash;
        registrant.network = network;
        console.log(`✅ Marked as minted: ${normalized} (TX: ${txHash})`);
    }
}

function walletExists(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    return db.registrants.some(r => r.wallet_address === normalized);
}

function isWalletMinted(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    const registrant = db.registrants.find(r => r.wallet_address === normalized);
    return registrant?.minted === 1;
}

function getRegistrant(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    return db.registrants.find(r => r.wallet_address === normalized) || null;
}

function getAllRegistrants() {
    return [...db.registrants].sort((a, b) => 
        new Date(b.registered_at) - new Date(a.registered_at)
    );
}

function getStats() {
    const total = db.registrants.length;
    const minted = db.registrants.filter(r => r.minted === 1).length;
    const pending = db.registrants.filter(r => r.minted === 0).length;
    
    return { total, minted, pending };
}

module.exports = {
    initDb,
    addRegistrant,
    getUnmintedRegistrants,
    markAsMinted,
    walletExists,
    isWalletMinted,
    getRegistrant,
    getAllRegistrants,
    getStats
};
