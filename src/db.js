// src/db.js - Simple in-memory database for Vercel

let registrants = [];
let initialized = false;

function initDb() {
    if (initialized) return;
    registrants = [];
    initialized = true;
    console.log('📦 In-memory database initialized');
}

function addRegistrant(walletAddress) {
    const normalized = walletAddress.toLowerCase();
    
    // Check if already exists
    const existing = registrants.find(r => r.wallet_address.toLowerCase() === normalized);
    if (existing) {
        console.log(`⚠️ Registrant already exists: ${walletAddress}`);
        return existing;
    }

    const registrant = {
        id: registrants.length + 1,
        wallet_address: walletAddress,
        minted: false,
        registered_at: new Date().toISOString(),
        minted_at: null,
        tx_hash: null,
        network: null
    };
    
    registrants.push(registrant);
    console.log(`📝 Added registrant #${registrant.id}: ${walletAddress}`);
    return registrant;
}

function getRegistrant(walletAddress) {
    if (!walletAddress) return null;
    const normalized = walletAddress.toLowerCase();
    return registrants.find(r => r.wallet_address.toLowerCase() === normalized) || null;
}

function markAsMinted(walletAddress, txHash, network) {
    if (!walletAddress) return false;
    const normalized = walletAddress.toLowerCase();
    const registrant = registrants.find(r => r.wallet_address.toLowerCase() === normalized);
    
    if (registrant) {
        registrant.minted = true;
        registrant.minted_at = new Date().toISOString();
        registrant.tx_hash = txHash;
        registrant.network = network;
        console.log(`✅ Marked as minted: ${walletAddress} | TX: ${txHash}`);
        return true;
    }
    
    console.log(`⚠️ Cannot mark as minted - registrant not found: ${walletAddress}`);
    return false;
}

function getAllRegistrants() {
    return [...registrants];
}

function getUnmintedRegistrants() {
    return registrants.filter(r => !r.minted);
}

function getMintedRegistrants() {
    return registrants.filter(r => r.minted);
}

function getStats() {
    const total = registrants.length;
    const minted = registrants.filter(r => r.minted).length;
    const pending = total - minted;
    
    return { total, minted, pending };
}

function walletExists(walletAddress) {
    if (!walletAddress) return false;
    const normalized = walletAddress.toLowerCase();
    return registrants.some(r => r.wallet_address.toLowerCase() === normalized);
}

function isWalletMinted(walletAddress) {
    const registrant = getRegistrant(walletAddress);
    return registrant ? registrant.minted : false;
}

function removeRegistrant(walletAddress) {
    if (!walletAddress) return false;
    const normalized = walletAddress.toLowerCase();
    const index = registrants.findIndex(r => r.wallet_address.toLowerCase() === normalized);
    
    if (index !== -1) {
        registrants.splice(index, 1);
        console.log(`🗑️ Removed registrant: ${walletAddress}`);
        return true;
    }
    return false;
}

function clearAll() {
    const count = registrants.length;
    registrants = [];
    console.log(`🗑️ Cleared all ${count} registrants`);
    return count;
}

function getRegistrantCount() {
    return registrants.length;
}

// Debug function to see current state
function debugPrint() {
    console.log('\n📊 DATABASE STATE:');
    console.log(`Total: ${registrants.length}`);
    console.log(`Minted: ${registrants.filter(r => r.minted).length}`);
    console.log(`Pending: ${registrants.filter(r => !r.minted).length}`);
    if (registrants.length > 0) {
        console.log('Registrants:');
        registrants.forEach(r => {
            console.log(`  - ${r.wallet_address} | minted: ${r.minted} | tx: ${r.tx_hash || 'none'}`);
        });
    }
    console.log('');
}

module.exports = {
    initDb,
    addRegistrant,
    getRegistrant,
    markAsMinted,
    getAllRegistrants,
    getUnmintedRegistrants,
    getMintedRegistrants,
    getStats,
    walletExists,
    isWalletMinted,
    removeRegistrant,
    clearAll,
    getRegistrantCount,
    debugPrint
};
