const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./db');
const minter = require('./minter');
const auth = require('./auth');
const { getNetworkConfig } = require('./config/networks');

// ===========================================
// Express App Setup
// ===========================================
const app = express();
const PORT = process.env.API_PORT || 3000;
const MINT_AMOUNT = parseInt(process.env.MINT_AMOUNT) || 2;
const SIGNATURE_MESSAGE = process.env.SIGNATURE_MESSAGE || 'FREE_BONUS_TOKENS_KEA_VALLEY';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================
// Authentication Middleware
// ===========================================

function requireAuth(req, res, next) {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    const session = auth.validateSession(sessionId);
    if (!session) {
        res.clearCookie('session');
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Session expired' });
        }
        return res.redirect('/login');
    }
    
    req.user = session;
    next();
}

function checkPasswordChange(req, res, next) {
    if (req.user?.mustChangePassword) {
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
        }
        return res.redirect('/change-password');
    }
    next();
}

// Validate Ethereum address
function validateAddress(address) {
    try {
        return ethers.isAddress(address);
    } catch {
        return false;
    }
}

// Verify signature
function verifySignature(signature, message, expectedWallet) {
    try {
        if (!signature || !message || !expectedWallet) {
            return { valid: false, error: 'Missing parameters' };
        }
        
        const recoveredAddress = ethers.verifyMessage(message, signature);
        const isValid = recoveredAddress.toLowerCase() === expectedWallet.toLowerCase();
        
        console.log(`Signature verification:`);
        console.log(`  Message: ${message}`);
        console.log(`  Expected: ${expectedWallet}`);
        console.log(`  Recovered: ${recoveredAddress}`);
        console.log(`  Valid: ${isValid}`);
        
        return {
            valid: isValid,
            recoveredAddress
        };
    } catch (error) {
        console.error('Signature verification error:', error.message);
        return {
            valid: false,
            error: error.message
        };
    }
}

// ===========================================
// Public Pages (No Auth Required)
// ===========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/claim', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'claim.html'));
});

app.get('/login', (req, res) => {
    const sessionId = req.cookies?.session;
    if (sessionId && auth.validateSession(sessionId)) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/change-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'change-password.html'));
});

// ===========================================
// Protected Pages (Auth Required)
// ===========================================

app.get('/dashboard', requireAuth, checkPasswordChange, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ===========================================
// Auth API Endpoints
// ===========================================

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const result = auth.login(username, password);
    
    if (result.success) {
        res.cookie('session', result.sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });
        
        res.json({
            success: true,
            mustChangePassword: result.mustChangePassword
        });
    } else {
        res.status(401).json({ error: result.error || 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    const sessionId = req.cookies?.session;
    if (sessionId) {
        auth.logout(sessionId);
    }
    res.clearCookie('session');
    res.json({ success: true });
});

app.get('/api/auth-status', (req, res) => {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        return res.json({ authenticated: false });
    }
    
    const session = auth.validateSession(sessionId);
    
    if (!session) {
        res.clearCookie('session');
        return res.json({ authenticated: false });
    }
    
    res.json({
        authenticated: true,
        username: session.username,
        mustChangePassword: session.mustChangePassword || false
    });
});

app.post('/api/change-password', (req, res) => {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const session = auth.validateSession(sessionId);
    if (!session) {
        res.clearCookie('session');
        return res.status(401).json({ error: 'Session expired' });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    if (!newPassword) {
        return res.status(400).json({ error: 'New password required' });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const result = auth.changePassword(session.username, currentPassword, newPassword);
    
    if (result.success) {
        auth.logout(sessionId);
        const loginResult = auth.login(session.username, newPassword);
        
        if (loginResult.success) {
            res.cookie('session', loginResult.sessionId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 24 * 60 * 60 * 1000
            });
        }
        
        res.json({ success: true });
    } else {
        res.status(400).json({ error: result.error || 'Failed to change password' });
    }
});

// ===========================================
// Public Claim API (No Auth Required)
// ===========================================

app.post('/api/claim/register', async (req, res) => {
    const { wallet_address, signature, message } = req.body;
    
    if (!wallet_address || !validateAddress(wallet_address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const normalizedAddress = wallet_address.toLowerCase();
    
    if (signature) {
        const verificationMessage = message || SIGNATURE_MESSAGE;
        const verification = verifySignature(signature, verificationMessage, wallet_address);
        
        if (!verification.valid) {
            return res.status(401).json({ 
                error: 'Invalid signature', 
                details: verification.error 
            });
        }
    }
    
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const hasTokens = await minter.hasTokens(wallet_address);
        const existingRegistrant = db.getRegistrant(normalizedAddress);
        
        if (hasTokens) {
            const balance = await minter.getBalance(wallet_address);
            
            if (!existingRegistrant) {
                db.addRegistrant(normalizedAddress);
                db.markAsMinted(normalizedAddress, 'ALREADY_HAD_TOKENS', networkConfig.name);
            } else if (!existingRegistrant.minted) {
                db.markAsMinted(normalizedAddress, 'ALREADY_HAD_TOKENS', networkConfig.name);
            }
            
            return res.status(409).json({
                status: 'already_claimed',
                wallet_address: normalizedAddress,
                balance: balance,
                tx_hash: existingRegistrant?.tx_hash || null,
                explorer_url: existingRegistrant?.tx_hash && existingRegistrant.tx_hash !== 'ALREADY_HAD_TOKENS' 
                    ? `${networkConfig.explorer}/tx/${existingRegistrant.tx_hash}` 
                    : null,
                message: 'This wallet already has KEA tokens'
            });
        }
        
        if (existingRegistrant && existingRegistrant.minted) {
            return res.status(409).json({
                status: 'already_claimed',
                wallet_address: normalizedAddress,
                tx_hash: existingRegistrant.tx_hash,
                explorer_url: existingRegistrant.tx_hash && existingRegistrant.tx_hash !== 'ALREADY_HAD_TOKENS'
                    ? `${networkConfig.explorer}/tx/${existingRegistrant.tx_hash}`
                    : null,
                message: 'This wallet has already claimed tokens'
            });
        }
        
        if (!existingRegistrant) {
            const addResult = db.addRegistrant(normalizedAddress);
            if (!addResult.success && addResult.duplicate) {
                const recheckRegistrant = db.getRegistrant(normalizedAddress);
                if (recheckRegistrant?.minted) {
                    return res.status(409).json({
                        status: 'already_claimed',
                        wallet_address: normalizedAddress,
                        message: 'This wallet has already claimed tokens'
                    });
                }
            }
        }
        
        console.log(`Minting ${MINT_AMOUNT} tokens to ${wallet_address}...`);
        
        const receipt = await minter.mintToAddress(wallet_address, MINT_AMOUNT);
        
        if (receipt && receipt.hash) {
            db.markAsMinted(normalizedAddress, receipt.hash, networkConfig.name);
            
            console.log(`✅ Minted ${MINT_AMOUNT} tokens to ${wallet_address}`);
            console.log(`   TX: ${networkConfig.explorer}/tx/${receipt.hash}`);
            
            return res.status(201).json({
                status: 'minted',
                wallet_address: normalizedAddress,
                amount: MINT_AMOUNT,
                symbol: minter.tokenSymbol || 'KEA',
                tx_hash: receipt.hash,
                explorer_url: `${networkConfig.explorer}/tx/${receipt.hash}`,
                message: `Successfully minted ${MINT_AMOUNT} KEA tokens!`
            });
        } else {
            return res.status(202).json({
                status: 'registered',
                wallet_address: normalizedAddress,
                message: 'Wallet registered. Tokens will be minted shortly.'
            });
        }
        
    } catch (error) {
        console.error('Claim error:', error);
        
        if (error.message?.includes('already has tokens')) {
            return res.status(409).json({
                status: 'already_claimed',
                wallet_address: normalizedAddress,
                message: 'This wallet already has tokens'
            });
        }
        
        return res.status(500).json({ 
            error: 'Failed to process claim',
            details: error.message 
        });
    }
});

app.get('/api/claim/status/:address', async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const normalizedAddress = address.toLowerCase();
    
    try {
        const registrant = db.getRegistrant(normalizedAddress);
        
        let onChainBalance = '0';
        try {
            await minter.initialize();
            onChainBalance = await minter.getBalance(address);
        } catch (e) {
            console.error('Error checking on-chain balance:', e.message);
        }
        
        const networkConfig = getNetworkConfig();
        
        if (registrant) {
            res.json({
                registered: true,
                minted: registrant.minted === 1,
                wallet_address: registrant.wallet_address,
                registered_at: registrant.registered_at,
                minted_at: registrant.minted_at,
                tx_hash: registrant.tx_hash,
                explorer_url: registrant.tx_hash && registrant.tx_hash !== 'ALREADY_HAD_TOKENS'
                    ? `${networkConfig.explorer}/tx/${registrant.tx_hash}`
                    : null,
                on_chain_balance: onChainBalance
            });
        } else if (parseFloat(onChainBalance) > 0) {
            res.json({
                registered: false,
                minted: true,
                wallet_address: normalizedAddress,
                on_chain_balance: onChainBalance,
                message: 'Wallet has tokens but was not registered through this system'
            });
        } else {
            res.json({
                registered: false,
                minted: false,
                wallet_address: normalizedAddress,
                on_chain_balance: '0'
            });
        }
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// ===========================================
// Protected API Endpoints (Auth Required)
// ===========================================

app.post('/api/register', requireAuth, checkPasswordChange, (req, res) => {
    const { wallet_address } = req.body;
    
    if (!wallet_address || !validateAddress(wallet_address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const result = db.addRegistrant(wallet_address.toLowerCase());
    
    if (result.success) {
        res.status(201).json({
            success: true,
            wallet_address: wallet_address.toLowerCase(),
            message: 'Wallet registered successfully'
        });
    } else if (result.duplicate) {
        res.status(409).json({
            error: 'Wallet already registered',
            wallet_address: wallet_address.toLowerCase()
        });
    } else {
        res.status(500).json({ error: result.error || 'Failed to register wallet' });
    }
});

app.post('/api/register/bulk', requireAuth, checkPasswordChange, (req, res) => {
    const { wallet_addresses } = req.body;
    
    if (!Array.isArray(wallet_addresses) || wallet_addresses.length === 0) {
        return res.status(400).json({ error: 'wallet_addresses must be a non-empty array' });
    }
    
    const result = db.addRegistrantsBulk(wallet_addresses);
    
    res.json({
        success: true,
        total: result.total,
        added: result.added,
        duplicates: result.duplicates,
        invalid: result.invalid,
        errors: result.errors
    });
});

app.get('/api/registrants', requireAuth, checkPasswordChange, (req, res) => {
    try {
        const registrants = db.getAllRegistrants();
        res.json({ registrants });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch registrants' });
    }
});

app.get('/api/registrants/pending', requireAuth, checkPasswordChange, (req, res) => {
    try {
        const registrants = db.getUnmintedRegistrants();
        res.json({ registrants });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pending registrants' });
    }
});

app.get('/api/registrants/:address', requireAuth, checkPasswordChange, (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const registrant = db.getRegistrant(address.toLowerCase());
    
    if (registrant) {
        res.json(registrant);
    } else {
        res.status(404).json({ error: 'Wallet not found' });
    }
});

app.get('/api/stats', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        const stats = db.getStats();
        let networkName = process.env.NETWORK || 'amoy';
        
        try {
            await minter.initialize();
            networkName = minter.getNetworkName();
        } catch (e) {
            console.error('Error getting network name:', e.message);
        }
        
        res.json({
            ...stats,
            network: networkName
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/wallet-info', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const walletAddress = minter.wallet.address;
        const balance = await minter.provider.getBalance(walletAddress);
        
        res.json({
            address: walletAddress,
            balance: ethers.formatEther(balance),
            currency: networkConfig.currency || 'POL',
            token_name: minter.tokenName,
            token_symbol: minter.tokenSymbol,
            token_address: networkConfig.tokenAddress,
            explorer: networkConfig.explorer,
            network: networkConfig.name
        });
    } catch (error) {
        console.error('Error getting wallet info:', error);
        res.status(500).json({ error: 'Failed to get wallet info' });
    }
});

app.get('/api/balance/:address', requireAuth, checkPasswordChange, async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        await minter.initialize();
        const balance = await minter.getBalance(address);
        
        res.json({
            address,
            balance,
            symbol: minter.tokenSymbol || 'KEA'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check balance' });
    }
});

app.post('/api/mint-now', requireAuth, checkPasswordChange, async (req, res) => {
    console.log('🔄 Manual mint requested via API...');
    
    try {
        const pending = db.getUnmintedRegistrants();
        
        if (pending.length === 0) {
            return res.json({
                success: true,
                message: 'No pending registrants to mint',
                minted: 0
            });
        }
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const addresses = pending.map(r => r.wallet_address);
        const balanceCheck = await minter.checkBalances(addresses);
        
        const toMint = balanceCheck.needsMinting;
        const alreadyHave = balanceCheck.alreadyHasTokens;
        
        for (const addr of alreadyHave) {
            db.markAsMinted(addr, 'ALREADY_HAD_TOKENS', networkConfig.name);
            console.log(`⏭️  ${addr} already has tokens, marked as complete`);
        }
        
        if (toMint.length === 0) {
            return res.json({
                success: true,
                message: 'All pending wallets already have tokens',
                minted: 0,
                skipped: alreadyHave.length
            });
        }
        
        const result = await minter.batchMintToAddresses(toMint, MINT_AMOUNT);
        
        if (result.receipt) {
            for (const addr of result.mintedAddresses) {
                db.markAsMinted(addr, result.receipt.hash, networkConfig.name);
            }
            
            console.log(`✅ Minted to ${result.mintedAddresses.length} wallets`);
            console.log(`   TX: ${networkConfig.explorer}/tx/${result.receipt.hash}`);
            
            return res.json({
                success: true,
                minted: result.mintedAddresses.length,
                skipped: alreadyHave.length + (result.skippedAddresses?.length || 0),
                tx_hash: result.receipt.hash,
                explorer_url: `${networkConfig.explorer}/tx/${result.receipt.hash}`
            });
        } else {
            return res.status(500).json({
                error: 'Minting failed',
                minted: 0
            });
        }
        
    } catch (error) {
        console.error('Mint error:', error);
        res.status(500).json({ error: 'Minting failed', details: error.message });
    }
});

app.post('/api/sync', requireAuth, checkPasswordChange, async (req, res) => {
    console.log('🔄 Sync requested via API...');
    
    try {
        const pending = db.getUnmintedRegistrants();
        
        if (pending.length === 0) {
            return res.json({
                success: true,
                message: 'No pending registrants to sync',
                synced: 0
            });
        }
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const addresses = pending.map(r => r.wallet_address);
        const balanceCheck = await minter.checkBalances(addresses);
        
        let synced = 0;
        
        for (const addr of balanceCheck.alreadyHasTokens) {
            db.markAsMinted(addr, 'ALREADY_HAD_TOKENS', networkConfig.name);
            synced++;
            console.log(`🔄 Synced: ${addr} already has tokens`);
        }
        
        const stats = db.getStats();
        
        res.json({
            success: true,
            synced,
            stillPending: balanceCheck.needsMinting.length,
            stats
        });
        
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Sync failed', details: error.message });
    }
});

// ===========================================
// Health Check (Public)
// ===========================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        network: process.env.NETWORK || 'amoy'
    });
});

// ===========================================
// Catch-all for SPA routing
// ===========================================

app.get('*', (req, res) => {
    res.redirect('/');
});

// ===========================================
// Start Server
// ===========================================

function startServer() {
    return new Promise((resolve) => {
        const server = app.listen(PORT, () => {
            console.log(`🌐 Server running on http://localhost:${PORT}`);
            console.log(`   Home:      http://localhost:${PORT}/`);
            console.log(`   Claim:     http://localhost:${PORT}/claim`);
            console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
            resolve(server);
        });
    });
}

module.exports = { app, startServer };
