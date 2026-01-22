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

// Serve static files with proper MIME types
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
    }
}));

// Ensure DB is initialized for each request (Vercel serverless)
app.use(async (req, res, next) => {
    try {
        await db.initDb();
        next();
    } catch (error) {
        console.error('DB initialization error:', error);
        next();
    }
});

// ===========================================
// Authentication Middleware
// ===========================================

function requireAuth(req, res, next) {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        console.log('No session cookie found');
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    const session = auth.validateSession(sessionId);
    if (!session) {
        console.log('Invalid or expired session');
        res.clearCookie('session', { path: '/' });
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
        
        console.log(`🔐 Signature verification:`);
        console.log(`   Message: ${message}`);
        console.log(`   Expected: ${expectedWallet}`);
        console.log(`   Recovered: ${recoveredAddress}`);
        console.log(`   Valid: ${isValid}`);
        
        return {
            valid: isValid,
            recoveredAddress
        };
    } catch (error) {
        console.error('🔐 Signature verification error:', error.message);
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

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile', 'index.html'));
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
// WalletTwo Token Exchange Proxy
// ===========================================

app.post('/api/wallettwo/exchange', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code is required' });
    }
    
    try {
        console.log('🔄 Exchanging WalletTwo code for token...');
        
        // Exchange code for access token (GET request with code as query param)
        const exchangeResponse = await fetch(`https://api.wallettwo.com/auth/consent?code=${code}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('📡 Exchange response status:', exchangeResponse.status);
        
        if (!exchangeResponse.ok) {
            const errorText = await exchangeResponse.text();
            console.error('❌ Exchange failed:', exchangeResponse.status, errorText);
            return res.status(exchangeResponse.status).json({ error: 'Exchange failed', details: errorText });
        }
        
        const tokenData = await exchangeResponse.json();
        console.log('✅ Token received:', Object.keys(tokenData));
        
        // Now fetch user info with the token
        if (tokenData.access_token) {
            const userResponse = await fetch('https://api.wallettwo.com/auth/userinfo', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`
                }
            });
            
            console.log('📡 User info response status:', userResponse.status);
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                console.log('✅ User data received:', Object.keys(userData));
                return res.json({
                    access_token: tokenData.access_token,
                    user: userData
                });
            }
        }
        
        res.json(tokenData);
        
    } catch (error) {
        console.error('❌ WalletTwo exchange error:', error);
        res.status(500).json({ error: 'Exchange failed', details: error.message });
    }
});

// ===========================================
// Auth API Endpoints
// ===========================================

app.post('/api/login', (req, res) => {
    console.log('Login attempt received');
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const result = auth.login(username, password);
    console.log('Login result:', result.success ? 'SUCCESS' : 'FAILED');
    
    if (result.success) {
        res.cookie('session', result.sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });
        
        res.json({
            success: true,
            mustChangePassword: result.mustChangePassword || false
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
    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
});

app.get('/api/auth-status', (req, res) => {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        return res.json({ authenticated: false });
    }
    
    const session = auth.validateSession(sessionId);
    
    if (!session) {
        res.clearCookie('session', { path: '/' });
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
        res.clearCookie('session', { path: '/' });
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
        const loginResult = auth.login(session.username, newPassword);
        
        if (loginResult.success) {
            res.cookie('session', loginResult.sessionId, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
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
    try {
        const { wallet_address, signature, message } = req.body;
        
        console.log('\n📥 CLAIM REQUEST:', { wallet_address, signature: signature ? 'provided' : 'none', message });

        if (!wallet_address || !ethers.isAddress(wallet_address)) {
            console.log('❌ Invalid wallet address');
            return res.status(400).json({ error: 'Invalid wallet address' });
        }

        const normalizedAddress = ethers.getAddress(wallet_address);
        console.log('📍 Normalized address:', normalizedAddress);

        if (signature && message) {
            try {
                const recoveredAddress = ethers.verifyMessage(message, signature);
                const isValid = recoveredAddress.toLowerCase() === normalizedAddress.toLowerCase();
                console.log('🔐 Signature verified:', isValid ? 'Valid' : 'Invalid');
            } catch (sigError) {
                console.log('⚠️ Signature verification failed:', sigError.message);
            }
        }

        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        let existingRegistrant = db.getRegistrant(normalizedAddress);
        
        if (existingRegistrant && existingRegistrant.minted) {
            console.log('📋 Already in DB and minted');
            return res.status(409).json({
                status: 'already_claimed',
                message: 'This wallet has already claimed tokens',
                tx_hash: existingRegistrant.tx_hash,
                explorer_url: existingRegistrant.tx_hash 
                    ? `${networkConfig.explorer}/tx/${existingRegistrant.tx_hash}` 
                    : null
            });
        }

        const hasTokensOnChain = await minter.hasTokens(normalizedAddress);
        const currentBalance = await minter.getBalance(normalizedAddress);
        
        console.log('💰 On-chain balance:', currentBalance, '| Has tokens:', hasTokensOnChain);

        if (hasTokensOnChain) {
            if (!existingRegistrant) {
                db.addRegistrant(normalizedAddress);
                console.log('📝 Added to in-memory DB (pre-existing holder)');
            }
            db.markAsMinted(normalizedAddress, 'pre-existing', networkConfig.name);
            console.log('✅ Marked as minted in DB');

            return res.status(409).json({
                status: 'already_claimed',
                message: 'This wallet already has tokens',
                balance: currentBalance,
                explorer_url: `${networkConfig.explorer}/address/${normalizedAddress}`
            });
        }

        if (!existingRegistrant) {
            db.addRegistrant(normalizedAddress);
            console.log('📝 Added new wallet to DB');
        }

        const mintAmount = parseInt(process.env.MINT_AMOUNT) || 2;
        console.log(`🎯 Minting ${mintAmount} tokens...`);

        try {
            const result = await minter.mintToAddress(normalizedAddress, mintAmount);
            
            if (result.skipped) {
                db.markAsMinted(normalizedAddress, 'skipped', networkConfig.name);
                return res.status(409).json({
                    status: 'already_claimed',
                    message: 'Wallet already has tokens',
                    balance: result.balance
                });
            }

            const txHash = result.receipt.hash;
            db.markAsMinted(normalizedAddress, txHash, networkConfig.name);
            
            console.log('✅ Mint successful! TX:', txHash);

            return res.status(201).json({
                status: 'minted',
                message: `Successfully minted ${mintAmount} VIP tokens!`,
                tx_hash: txHash,
                explorer_url: `${networkConfig.explorer}/tx/${txHash}`,
                amount: mintAmount,
                symbol: 'VIP'
            });

        } catch (mintError) {
            console.error('❌ Mint error:', mintError.message);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to mint tokens. Please try again later.',
                error: mintError.message
            });
        }

    } catch (error) {
        console.error('❌ CLAIM ERROR:', error.message);
        return res.status(500).json({
            status: 'error',
            message: 'Server error',
            error: error.message
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

app.get('/api/registrants', requireAuth, (req, res) => {
    try {
        const registrants = db.getAllRegistrants();
        res.json({ 
            success: true,
            registrants: registrants,
            count: registrants.length
        });
    } catch (error) {
        console.error('Error getting registrants:', error);
        res.status(500).json({ error: 'Failed to get registrants' });
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

app.get('/api/stats', requireAuth, (req, res) => {
    try {
        const stats = db.getStats();
        const networkConfig = getNetworkConfig();
        
        res.json({
            total: stats.total || 0,
            minted: stats.minted || 0,
            pending: stats.pending || 0,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

app.get('/api/wallet-info', requireAuth, async (req, res) => {
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const balance = await minter.provider.getBalance(minter.wallet.address);
        const balanceFormatted = ethers.formatEther(balance);
        
        res.json({
            address: minter.wallet.address,
            balance: balanceFormatted,
            currency: networkConfig.currency,
            network: networkConfig.name,
            tokenAddress: networkConfig.tokenAddress,
            tokenName: minter.tokenName,
            tokenSymbol: minter.tokenSymbol
        });
    } catch (error) {
        console.error('Wallet info error:', error);
        res.status(500).json({ 
            error: 'Failed to get wallet info',
            details: error.message 
        });
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
            symbol: minter.tokenSymbol || 'VIP'
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
        
        let mintedCount = 0;
        let skippedCount = 0;
        let lastTxHash = null;
        
        for (const registrant of pending) {
            try {
                const hasTokens = await minter.hasTokens(registrant.wallet_address);
                if (hasTokens) {
                    db.markAsMinted(registrant.wallet_address, 'ALREADY_HAD_TOKENS', networkConfig.name);
                    skippedCount++;
                    continue;
                }
                
                const receipt = await minter.mintToAddress(registrant.wallet_address, MINT_AMOUNT);
                if (receipt && receipt.hash) {
                    db.markAsMinted(registrant.wallet_address, receipt.hash, networkConfig.name);
                    lastTxHash = receipt.hash;
                    mintedCount++;
                }
            } catch (mintError) {
                console.error(`Failed to mint to ${registrant.wallet_address}:`, mintError.message);
            }
        }
        
        return res.json({
            success: true,
            minted: mintedCount,
            skipped: skippedCount,
            tx_hash: lastTxHash,
            explorer_url: lastTxHash ? `${networkConfig.explorer}/tx/${lastTxHash}` : null
        });
        
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
        
        let synced = 0;
        
        for (const registrant of pending) {
            try {
                const hasTokens = await minter.hasTokens(registrant.wallet_address);
                if (hasTokens) {
                    db.markAsMinted(registrant.wallet_address, 'ALREADY_HAD_TOKENS', networkConfig.name);
                    synced++;
                    console.log(`🔄 Synced: ${registrant.wallet_address} already has tokens`);
                }
            } catch (error) {
                console.error(`Error checking ${registrant.wallet_address}:`, error.message);
            }
        }
        
        const stats = db.getStats();
        
        res.json({
            success: true,
            synced,
            stillPending: pending.length - synced,
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

app.get('/api/health', async (req, res) => {
    const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        network: process.env.NETWORK || 'not set',
        env: {
            NETWORK: process.env.NETWORK ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_AMOY: process.env.TOKEN_ADDRESS_AMOY ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON ? 'SET' : 'NOT SET',
            PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'NOT SET',
            MINT_AMOUNT: process.env.MINT_AMOUNT || '2 (default)',
            ADMIN_USERNAME: process.env.ADMIN_USERNAME ? 'SET' : 'NOT SET',
            ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'SET' : 'NOT SET'
        }
    };

    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        healthData.minter = {
            status: 'initialized',
            wallet: minter.wallet.address,
            tokenAddress: networkConfig.tokenAddress,
            tokenName: minter.tokenName,
            tokenSymbol: minter.tokenSymbol,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        };
    } catch (error) {
        healthData.minter = {
            status: 'error',
            error: error.message
        };
    }

    res.json(healthData);
});

// ===========================================
// Catch-all
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
            console.log(`   Profile:   http://localhost:${PORT}/profile`);
            console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
            console.log(`   Health:    http://localhost:${PORT}/api/health`);
            resolve(server);
        });
    });
}

module.exports = { app, startServer };
