const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./db-postgres');
const minter = require('./minter');
const auth = require('./auth');
const { getNetworkConfig } = require('./config/networks');

// ===========================================
// Stripe Setup (Optional - graceful fallback)
// ===========================================
let stripe = null;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        const Stripe = require('stripe');
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        console.log('✅ Stripe initialized');
    } else {
        console.log('⚠️ Stripe not configured (STRIPE_SECRET_KEY missing)');
    }
} catch (e) {
    console.log('⚠️ Stripe not available:', e.message);
}

// ===========================================
// Presale Configuration
// ===========================================
const PRESALE_CONFIG = {
    tokenPrice: parseFloat(process.env.PRESALE_TOKEN_PRICE) || 0.10,
    totalTokens: parseInt(process.env.PRESALE_TOTAL_TOKENS) || 1000000,
    minPurchase: parseInt(process.env.PRESALE_MIN_PURCHASE) || 10,
    maxPurchase: parseInt(process.env.PRESALE_MAX_PURCHASE) || 10000,
    enabled: process.env.PRESALE_ENABLED !== 'false'
};

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

async function initializeMinter() {
    const networkConfig = getNetworkConfig();
    await minter.initialize();
    
    return { 
        minter, 
        networkConfig 
    };
}

// ===========================================
// Authentication Middleware
// ===========================================

async function requireAuth(req, res, next) {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        console.log('No session cookie found');
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    const session = await auth.validateSession(sessionId);
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
// Wallet Connection API (Save wallet + email from profile)
// ===========================================

app.post('/api/wallet/connect', async (req, res) => {
    try {
        const { walletAddress, email, name, source } = req.body;

        console.log('[Wallet Connect] Received:', { walletAddress, email, name, source });

        // Validate wallet address
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid wallet address' 
            });
        }

        const normalizedAddress = walletAddress.toLowerCase();

        // Check if registrant exists
        let registrant = await db.getRegistrant(normalizedAddress);

        if (registrant) {
            // Update existing - add email if missing
            if ((email && !registrant.email) || (name)) {
                try {
                    await db.pool.query(
                        `UPDATE registrants 
                         SET email = COALESCE($1, email),
                             metadata = jsonb_set(COALESCE(metadata, '{}'), '{name}', $2::jsonb),
                             updated_at = NOW() 
                         WHERE LOWER(address) = $3`,
                        [email || null, JSON.stringify(name || null), normalizedAddress]
                    );
                    console.log(`[Wallet Connect] Updated: ${normalizedAddress}, email: ${email}, name: ${name}`);
                } catch (updateErr) {
                    console.error('[Wallet Connect] Update error:', updateErr.message);
                }
            }
            
            return res.json({
                success: true,
                action: 'updated',
                walletAddress: normalizedAddress,
                email: email || registrant.email
            });
        }

        // Insert new registrant with email
        try {
            await db.pool.query(
                `INSERT INTO registrants (address, email, source, metadata, registered_at, updated_at) 
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 ON CONFLICT (address) DO UPDATE SET 
                    email = COALESCE(EXCLUDED.email, registrants.email),
                    metadata = COALESCE(EXCLUDED.metadata, registrants.metadata),
                    updated_at = NOW()`,
                [normalizedAddress, email || null, source || 'wallettwo', JSON.stringify({ name: name || null })]
            );
            console.log(`[Wallet Connect] Created: ${normalizedAddress}, email: ${email}, name: ${name}`);
        } catch (insertErr) {
            console.error('[Wallet Connect] Insert error:', insertErr.message);
        }

        return res.json({
            success: true,
            action: 'created',
            walletAddress: normalizedAddress,
            email: email
        });

    } catch (error) {
        console.error('[Wallet Connect] Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to save wallet connection' 
        });
    }
});

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

app.get('/presale', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'presale.html'));
});

app.get('/login', async (req, res) => {
    const sessionId = req.cookies?.session;
    if (sessionId) {
        const session = await auth.validateSession(sessionId);
        if (session) {
            return res.redirect('/dashboard');
        }
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

app.post('/api/login', async (req, res) => {
    console.log('Login attempt received');
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const result = await auth.authenticate(username, password);
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

app.post('/api/logout', async (req, res) => {
    const sessionId = req.cookies?.session;
    if (sessionId) {
        await auth.logout(sessionId);
    }
    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
});

app.get('/api/auth-status', async (req, res) => {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        return res.json({ authenticated: false });
    }
    
    const session = await auth.validateSession(sessionId);
    
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

app.post('/api/change-password', async (req, res) => {
    const sessionId = req.cookies?.session;
    
    if (!sessionId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const session = await auth.validateSession(sessionId);
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
    
    const result = await auth.changePassword(session.username, newPassword);
    
    if (result.success) {
        // Re-authenticate to get new session without mustChangePassword
        const loginResult = await auth.authenticate(session.username, newPassword);
        
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

        const normalizedAddress = ethers.getAddress(wallet_address).toLowerCase();
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
        
        // Check if already registered in PostgreSQL
        let existingRegistrant = await db.getRegistrant(normalizedAddress);
        
        if (existingRegistrant && existingRegistrant.minted) {
            console.log('📋 Already in DB and minted');
            return res.status(409).json({
                status: 'already_claimed',
                message: 'This wallet has already claimed tokens',
                tx_hash: existingRegistrant.txHash,
                explorer_url: existingRegistrant.txHash 
                    ? `${networkConfig.explorer}/tx/${existingRegistrant.txHash}` 
                    : null
            });
        }

        const hasTokensOnChain = await minter.hasTokens(normalizedAddress);
        const currentBalance = await minter.getBalance(normalizedAddress);
        
        console.log('💰 On-chain balance:', currentBalance, '| Has tokens:', hasTokensOnChain);

        if (hasTokensOnChain) {
            if (!existingRegistrant) {
                await db.addRegistrant(normalizedAddress, signature, { source: 'claim_page', preExisting: true });
                console.log('📝 Added to PostgreSQL DB (pre-existing holder)');
            }
            await db.markAsMinted(normalizedAddress, 'pre-existing');
            console.log('✅ Marked as minted in DB');

            return res.status(409).json({
                status: 'already_claimed',
                message: 'This wallet already has tokens',
                balance: currentBalance,
                explorer_url: `${networkConfig.explorer}/address/${normalizedAddress}`
            });
        }

        if (!existingRegistrant) {
            await db.addRegistrant(normalizedAddress, signature, { source: 'claim_page' });
            console.log('📝 Added new wallet to PostgreSQL DB');
        }

        const mintAmount = parseInt(process.env.MINT_AMOUNT) || 2;
        console.log(`🎯 Minting ${mintAmount} tokens...`);

        try {
            const result = await minter.mintToAddress(normalizedAddress, mintAmount);
            
            if (result.skipped) {
                await db.markAsMinted(normalizedAddress, 'skipped');
                return res.status(409).json({
                    status: 'already_claimed',
                    message: 'Wallet already has tokens',
                    balance: result.balance
                });
            }

            const txHash = result.receipt.hash;
            await db.markAsMinted(normalizedAddress, txHash);
            
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
        const registrant = await db.getRegistrant(normalizedAddress);
        
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
                minted: registrant.minted,
                wallet_address: registrant.address,
                registered_at: registrant.registeredAt,
                minted_at: registrant.mintedAt,
                tx_hash: registrant.txHash,
                explorer_url: registrant.txHash && registrant.txHash !== 'ALREADY_HAD_TOKENS' && registrant.txHash !== 'pre-existing' && registrant.txHash !== 'skipped'
                    ? `${networkConfig.explorer}/tx/${registrant.txHash}`
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

app.post('/api/register', requireAuth, checkPasswordChange, async (req, res) => {
    const { wallet_address } = req.body;
    
    if (!wallet_address || !validateAddress(wallet_address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        const normalizedAddress = wallet_address.toLowerCase();
        
        // Check if already exists
        const existing = await db.hasRegistrant(normalizedAddress);
        if (existing) {
            return res.status(409).json({
                error: 'Wallet already registered',
                wallet_address: normalizedAddress
            });
        }
        
        const registrant = await db.addRegistrant(normalizedAddress, null, { source: 'admin' });
        
        res.status(201).json({
            success: true,
            wallet_address: normalizedAddress,
            message: 'Wallet registered successfully',
            registrant
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Failed to register wallet' });
    }
});

app.get('/api/registrants', requireAuth, async (req, res) => {
    try {
        const registrants = await db.getAllRegistrants();
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

app.get('/api/registrants/pending', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        const registrants = await db.getPendingRegistrants();
        res.json({ registrants });
    } catch (error) {
        console.error('Error getting pending registrants:', error);
        res.status(500).json({ error: 'Failed to fetch pending registrants' });
    }
});

app.get('/api/registrants/:address', requireAuth, checkPasswordChange, async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        const registrant = await db.getRegistrant(address.toLowerCase());
        
        if (registrant) {
            res.json(registrant);
        } else {
            res.status(404).json({ error: 'Wallet not found' });
        }
    } catch (error) {
        console.error('Error getting registrant:', error);
        res.status(500).json({ error: 'Failed to get registrant' });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const stats = await db.getStats();
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
        console.error('Balance error:', error);
        res.status(500).json({ error: 'Failed to check balance' });
    }
});

app.post('/api/mint-now', requireAuth, checkPasswordChange, async (req, res) => {
    console.log('🔄 Manual mint requested via API...');
    
    try {
        const pending = await db.getPendingRegistrants();
        
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
                const hasTokens = await minter.hasTokens(registrant.address);
                if (hasTokens) {
                    await db.markAsMinted(registrant.address, 'ALREADY_HAD_TOKENS');
                    skippedCount++;
                    continue;
                }
                
                const receipt = await minter.mintToAddress(registrant.address, MINT_AMOUNT);
                if (receipt && receipt.hash) {
                    await db.markAsMinted(registrant.address, receipt.hash);
                    lastTxHash = receipt.hash;
                    mintedCount++;
                }
            } catch (mintError) {
                console.error(`Failed to mint to ${registrant.address}:`, mintError.message);
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
        const pending = await db.getPendingRegistrants();
        
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
                const hasTokens = await minter.hasTokens(registrant.address);
                if (hasTokens) {
                    await db.markAsMinted(registrant.address, 'ALREADY_HAD_TOKENS');
                    synced++;
                    console.log(`🔄 Synced: ${registrant.address} already has tokens`);
                }
            } catch (error) {
                console.error(`Error checking ${registrant.address}:`, error.message);
            }
        }
        
        const stats = await db.getStats();
        
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

// ============================================
// Full Sync - Get all holders, balances, and transactions
// ============================================
app.post('/api/full-sync', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        // Use the existing minter instance
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        // Get Polygonscan API key from env (optional but recommended for higher rate limits)
        const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';
        const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
        const VIP_TOKEN_ADDRESS = networkConfig.tokenAddress || '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
        
        // Get minter wallet address
        const minterAddress = minter.wallet?.address || process.env.MINTER_ADDRESS || '';
        
        // Get all registrants from DB
        const registrants = await db.getAllRegistrants();
        
        const results = {
            total: registrants.length,
            withBalance: 0,
            withoutBalance: 0,
            updated: 0,
            txHashesFound: 0,
            registrants: []
        };
        
        console.log(`🔄 Full sync starting for ${registrants.length} registrants...`);
        
        // Process each registrant
        for (const registrant of registrants) {
            try {
                // Get current balance
                const balance = await minter.getBalance(registrant.address);
                const hasBalance = parseFloat(balance) > 0;
                
                if (hasBalance) {
                    results.withBalance++;
                } else {
                    results.withoutBalance++;
                }
                
                let txHash = registrant.tx_hash;
                let needsUpdate = false;
                
                // If has balance but no valid tx hash, try to find the mint transaction
                const hasValidTxHash = txHash && 
                    txHash !== 'synced-from-chain' && 
                    txHash !== 'ALREADY_HAD_TOKENS' && 
                    txHash !== 'pre-existing' && 
                    txHash !== 'skipped' &&
                    txHash.startsWith('0x');
                
                if (hasBalance && !hasValidTxHash) {
                    try {
                        // Query Polygonscan for token transfers TO this address
                        const apiUrl = `${POLYGONSCAN_API}?module=account&action=tokentx` +
                            `&contractaddress=${VIP_TOKEN_ADDRESS}` +
                            `&address=${registrant.address}` +
                            `&page=1&offset=100&sort=desc` +
                            (POLYGONSCAN_API_KEY ? `&apikey=${POLYGONSCAN_API_KEY}` : '');
                        
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        if (data.status === '1' && data.result && data.result.length > 0) {
                            // Find transfers TO this address (preferably from minter)
                            let mintTx = null;
                            
                            // First try to find transfer from our minter
                            if (minterAddress) {
                                mintTx = data.result.find(tx => 
                                    tx.from.toLowerCase() === minterAddress.toLowerCase() &&
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            // If not found, get any incoming transfer
                            if (!mintTx) {
                                mintTx = data.result.find(tx => 
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            if (mintTx && mintTx.hash) {
                                txHash = mintTx.hash;
                                results.txHashesFound++;
                                needsUpdate = true;
                                console.log(`  📝 Found TX for ${registrant.address.slice(0,10)}...: ${txHash.slice(0,10)}...`);
                            }
                        }
                    } catch (apiError) {
                        console.error(`  ⚠️ Polygonscan API error for ${registrant.address}:`, apiError.message);
                    }
                    
                    // Rate limit delay (Polygonscan free tier: 5 req/sec)
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                
                // Update DB if needed
                if (hasBalance && !registrant.minted) {
                    await db.markAsMinted(registrant.address, txHash || 'synced-from-chain');
                    results.updated++;
                    console.log(`  ✅ Marked as minted: ${registrant.address.slice(0,10)}...`);
                } else if (needsUpdate && txHash) {
                    // Update tx hash if we found a new one
                    await db.markAsMinted(registrant.address, txHash);
                    results.updated++;
                    console.log(`  🔄 Updated TX hash for: ${registrant.address.slice(0,10)}...`);
                }
                
                results.registrants.push({
                    address: registrant.address,
                    balance: balance,
                    minted: hasBalance || registrant.minted,
                    txHash: txHash || registrant.tx_hash,
                    registeredAt: registrant.registered_at
                });
                
            } catch (regError) {
                console.error(`  ❌ Error processing ${registrant.address}:`, regError.message);
                results.registrants.push({
                    address: registrant.address,
                    balance: 'error',
                    minted: registrant.minted,
                    txHash: registrant.tx_hash,
                    registeredAt: registrant.registered_at,
                    error: regError.message
                });
            }
        }
        
        const stats = await db.getStats();
        
        console.log(`✅ Full sync completed: ${results.updated} updated, ${results.txHashesFound} TX hashes found`);
        
        res.json({
            success: true,
            message: `Full sync completed. Updated ${results.updated} records, found ${results.txHashesFound} TX hashes.`,
            results,
            stats,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
        
    } catch (error) {
        console.error('❌ Full sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Manual Mint endpoint
app.post('/api/mint-manual', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({
                success: false,
                error: 'Address is required'
            });
        }
        
        // Validate address
        if (!ethers.isAddress(address)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid wallet address'
            });
        }
        
        const normalizedAddress = address.toLowerCase();
        
        // Use existing minter instance
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        const mintAmount = parseInt(process.env.MINT_AMOUNT) || 2;
        
        // Check current balance
        const currentBalance = await minter.getBalance(normalizedAddress);
        if (parseFloat(currentBalance) >= mintAmount) {
            return res.json({
                success: false,
                message: `Wallet already has ${currentBalance} tokens`,
                address: normalizedAddress,
                balance: currentBalance
            });
        }
        
        // Mint tokens
        console.log(`🎯 Manual minting ${mintAmount} tokens to ${normalizedAddress}`);
        const result = await minter.mintToAddress(normalizedAddress, mintAmount);
        
        if (result.skipped) {
            return res.json({
                success: false,
                message: result.reason || 'Minting skipped',
                address: normalizedAddress
            });
        }
        
        const txHash = result.receipt?.hash || result.hash;
        
        // Ensure registrant exists in DB and mark as minted
        let registrant = await db.getRegistrant(normalizedAddress);
        if (!registrant) {
            await db.addRegistrant(normalizedAddress, null, { source: 'manual-mint' });
        }
        await db.markAsMinted(normalizedAddress, txHash);
        
        console.log(`✅ Manual mint successful: ${txHash}`);
        
        res.json({
            success: true,
            message: `Successfully minted ${mintAmount} tokens`,
            address: normalizedAddress,
            amount: mintAmount,
            tx_hash: txHash,
            explorer_url: `${networkConfig.explorer}/tx/${txHash}`
        });
        
    } catch (error) {
        console.error('❌ Manual mint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===========================================
// Presale API Endpoints
// ===========================================

// Get presale configuration
app.get('/api/presale/config', async (req, res) => {
    try {
        // Try to get stats, but don't fail if function doesn't exist yet
        let stats = { tokensSold: 0 };
        try {
            stats = await db.getPresaleStats() || { tokensSold: 0 };
        } catch (e) {
            console.log('Presale stats not available yet');
        }
        
        // Fetch POL price from CoinGecko
        let polPrice = 0.50;
        try {
            const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd');
            if (priceRes.ok) {
                const priceData = await priceRes.json();
                polPrice = priceData['matic-network']?.usd || 0.50;
            }
        } catch (e) {
            console.log('Using default POL price');
        }
        
        res.json({
            tokenPrice: PRESALE_CONFIG.tokenPrice,
            totalTokens: PRESALE_CONFIG.totalTokens,
            tokensSold: stats?.tokensSold || 0,
            minPurchase: PRESALE_CONFIG.minPurchase,
            maxPurchase: PRESALE_CONFIG.maxPurchase,
            enabled: PRESALE_CONFIG.enabled,
            polPrice,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY || null
        });
    } catch (error) {
        console.error('Presale config error:', error);
        res.status(500).json({ error: 'Failed to load config' });
    }
});

// Create Stripe Checkout Session
app.post('/api/presale/create-checkout', async (req, res) => {
    // Check if Stripe is configured
    if (!stripe) {
        return res.status(503).json({ error: 'Card payments not configured. Please use crypto payment.' });
    }
    
    try {
        const { wallet_address, token_amount, amount_usd } = req.body;
        
        // Validation
        if (!wallet_address || !ethers.isAddress(wallet_address)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!token_amount || token_amount < PRESALE_CONFIG.minPurchase) {
            return res.status(400).json({ error: `Minimum purchase is ${PRESALE_CONFIG.minPurchase} tokens` });
        }
        
        if (token_amount > PRESALE_CONFIG.maxPurchase) {
            return res.status(400).json({ error: `Maximum purchase is ${PRESALE_CONFIG.maxPurchase} tokens` });
        }
        
        if (!PRESALE_CONFIG.enabled) {
            return res.status(400).json({ error: 'Presale is not active' });
        }
        
        // Check remaining tokens
        let stats = { tokensSold: 0 };
        try {
            stats = await db.getPresaleStats() || { tokensSold: 0 };
        } catch (e) {}
        
        const remaining = PRESALE_CONFIG.totalTokens - (stats?.tokensSold || 0);
        if (token_amount > remaining) {
            return res.status(400).json({ error: `Only ${remaining} tokens remaining` });
        }
        
        const normalizedAddress = wallet_address.toLowerCase();
        const totalCents = Math.round(amount_usd * 100);
        
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'VIP Token Presale',
                        description: `${token_amount.toLocaleString()} VIP Tokens`
                    },
                    unit_amount: totalCents
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${process.env.BASE_URL || 'https://kea-valley.com'}/presale?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL || 'https://kea-valley.com'}/presale?canceled=true`,
            metadata: {
                wallet_address: normalizedAddress,
                token_amount: token_amount.toString(),
                price_per_token: PRESALE_CONFIG.tokenPrice.toString()
            },
            billing_address_collection: 'auto'
        });
        
        // Save pending purchase to database
        try {
            await db.addPresalePurchase({
                wallet_address: normalizedAddress,
                token_amount: token_amount,
                payment_method: 'card',
                payment_amount: amount_usd,
                usd_amount: amount_usd,
                status: 'pending',
                stripe_session_id: session.id
            });
        } catch (e) {
            console.log('Could not save presale purchase to DB:', e.message);
        }
        
        console.log(`💳 Stripe checkout created for ${token_amount} VIP to ${normalizedAddress}`);
        
        res.json({
            sessionId: session.id,
            url: session.url
        });
        
    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: error.message || 'Failed to create checkout' });
    }
});

// Stripe Webhook Handler (needs raw body)
app.post('/api/presale/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ error: 'Stripe not configured' });
    }
    
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
        console.error('STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).json({ error: 'Webhook not configured' });
    }
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            
            console.log('✅ Payment successful:', session.id);
            
            // Update purchase status
            try {
                await db.updatePresalePurchaseByStripeSession(session.id, {
                    status: 'paid',
                    stripe_payment_intent: session.payment_intent
                });
            } catch (e) {
                console.log('Could not update presale purchase:', e.message);
            }
            
            // Get purchase details from metadata
            const walletAddress = session.metadata.wallet_address;
            const tokenAmount = parseInt(session.metadata.token_amount);
            
            // Mint tokens
            try {
                await minter.initialize();
                const networkConfig = getNetworkConfig();
                
                console.log(`🎯 Minting ${tokenAmount} VIP to ${walletAddress}`);
                const result = await minter.mintToAddress(walletAddress, tokenAmount);
                
                if (result.receipt?.hash) {
                    try {
                        await db.updatePresalePurchaseByStripeSession(session.id, {
                            status: 'minted',
                            tx_hash: result.receipt.hash
                        });
                    } catch (e) {}
                    console.log(`✅ Minted! TX: ${result.receipt.hash}`);
                }
            } catch (mintError) {
                console.error('Minting error:', mintError);
                try {
                    await db.updatePresalePurchaseByStripeSession(session.id, {
                        status: 'paid_pending_mint'
                    });
                } catch (e) {}
            }
            break;
            
        case 'checkout.session.expired':
            const expiredSession = event.data.object;
            try {
                await db.updatePresalePurchaseByStripeSession(expiredSession.id, {
                    status: 'expired'
                });
            } catch (e) {}
            break;
            
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
});

// Crypto purchase (POL/USDC)
app.post('/api/presale/purchase', async (req, res) => {
    try {
        const { wallet_address, token_amount, payment_method, payment_amount } = req.body;
        
        if (!wallet_address || !ethers.isAddress(wallet_address)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!token_amount || token_amount < PRESALE_CONFIG.minPurchase) {
            return res.status(400).json({ error: `Minimum purchase is ${PRESALE_CONFIG.minPurchase} tokens` });
        }
        
        if (token_amount > PRESALE_CONFIG.maxPurchase) {
            return res.status(400).json({ error: `Maximum purchase is ${PRESALE_CONFIG.maxPurchase} tokens` });
        }
        
        const normalizedAddress = wallet_address.toLowerCase();
        const usdAmount = token_amount * PRESALE_CONFIG.tokenPrice;
        
        let purchase = { id: Date.now() };
        try {
            purchase = await db.addPresalePurchase({
                wallet_address: normalizedAddress,
                token_amount: token_amount,
                payment_method: payment_method,
                payment_amount: payment_amount,
                usd_amount: usdAmount,
                status: 'pending_payment'
            });
        } catch (e) {
            console.log('Could not save presale purchase:', e.message);
        }
        
        console.log(`📦 Crypto purchase recorded: ${token_amount} VIP for ${normalizedAddress}`);
        
        res.json({
            success: true,
            purchase_id: purchase.id,
            message: 'Purchase recorded. Please send payment to complete.',
            payment_wallet: process.env.PRESALE_WALLET || 'Contact support for payment address'
        });
        
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ error: 'Purchase failed' });
    }
});

// GET /api/presale/admin/stats
app.get('/api/presale/admin/stats', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        await db.initDb();
        const stats = await db.getPresaleStats();
        
        // Count pending mint
        const pendingResult = await db.pool.query(
            `SELECT COUNT(*) FROM presale_purchases WHERE status IN ('paid', 'paid_pending_mint')`
        );
        
        res.json({
            ...stats,
            pending_mint: parseInt(pendingResult.rows[0]?.count || 0)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/presale/admin/settings
app.post('/api/presale/admin/settings', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        const { enabled, tokenPrice, totalTokens, minPurchase, maxPurchase, presaleWallet } = req.body;
        
        // Store in environment or database
        // For now, just acknowledge (actual persistence depends on your setup)
        PRESALE_CONFIG.enabled = enabled;
        PRESALE_CONFIG.tokenPrice = tokenPrice;
        PRESALE_CONFIG.totalTokens = totalTokens;
        PRESALE_CONFIG.minPurchase = minPurchase;
        PRESALE_CONFIG.maxPurchase = maxPurchase;
        PRESALE_CONFIG.presaleWallet = presaleWallet;
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Get all presale purchases
app.get('/api/presale/admin/purchases', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        let purchases = [];
        let stats = { tokensSold: 0, totalUSD: 0, uniqueBuyers: 0 };
        
        try {
            purchases = await db.getAllPresalePurchases() || [];
            stats = await db.getPresaleStats() || stats;
        } catch (e) {
            console.log('Presale data not available:', e.message);
        }
        
        res.json({
            purchases,
            stats,
            config: PRESALE_CONFIG
        });
    } catch (error) {
        console.error('Error fetching presale data:', error);
        res.status(500).json({ error: 'Failed to fetch presale data' });
    }
});

// Admin: Manually fulfill purchase
app.post('/api/presale/admin/fulfill', requireAuth, checkPasswordChange, async (req, res) => {
    try {
        const { purchase_id } = req.body;
        
        const purchase = await db.getPresalePurchaseById(purchase_id);
        if (!purchase) {
            return res.status(404).json({ error: 'Purchase not found' });
        }
        
        if (purchase.status === 'minted') {
            return res.status(400).json({ error: 'Already fulfilled' });
        }
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const result = await minter.mintToAddress(purchase.wallet_address, purchase.token_amount);
        
        if (result.receipt?.hash) {
            await db.updatePresalePurchase(purchase_id, {
                status: 'minted',
                tx_hash: result.receipt.hash
            });
            
            res.json({
                success: true,
                tx_hash: result.receipt.hash,
                explorer_url: `${networkConfig.explorer}/tx/${result.receipt.hash}`
            });
        } else {
            res.status(500).json({ error: 'Minting failed' });
        }
        
    } catch (error) {
        console.error('Fulfill error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/wallet/connect - Save wallet address and email when user connects via WalletTwo
app.post('/api/wallet/connect', async (req, res) => {
    try {
        const { walletAddress, email, source } = req.body;

        // Validate wallet address
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid wallet address' 
            });
        }

        // Normalize address to lowercase
        const normalizedAddress = walletAddress.toLowerCase();

        console.log(`[Wallet Connect] Address: ${normalizedAddress}, Email: ${email || 'N/A'}, Source: ${source || 'wallettwo'}`);

        // Upsert registrant with email
        const registrant = await db.upsertRegistrant(normalizedAddress, email || null, source || 'wallettwo');

        if (registrant) {
            console.log(`[Wallet Connect] Saved/Updated: ${normalizedAddress}`);
            return res.json({
                success: true,
                action: registrant.email === email ? 'updated' : 'created',
                walletAddress: normalizedAddress,
                email: registrant.email
            });
        }

        res.json({
            success: true,
            action: 'exists',
            walletAddress: normalizedAddress
        });

    } catch (error) {
        console.error('[Wallet Connect] Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to save wallet connection' 
        });
    }
});

// GET /api/wallet/info/:address - Get wallet info including email
app.get('/api/wallet/info/:address', async (req, res) => {
    try {
        const { address } = req.params;

        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid wallet address' 
            });
        }

        const normalizedAddress = address.toLowerCase();
        const registrant = await db.getRegistrant(normalizedAddress);

        if (!registrant) {
            return res.json({
                success: true,
                exists: false,
                walletAddress: normalizedAddress
            });
        }

        res.json({
            success: true,
            exists: true,
            walletAddress: registrant.address,
            email: registrant.email,
            minted: registrant.minted,
            txHash: registrant.tx_hash,
            source: registrant.source,
            createdAt: registrant.registered_at,
            updatedAt: registrant.updated_at
        });

    } catch (error) {
        console.error('[Wallet Info] Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to get wallet info' 
        });
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
        stripe: stripe ? 'configured' : 'not configured',
        env: {
            NETWORK: process.env.NETWORK ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON ? 'SET' : 'NOT SET',
            PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'NOT SET',
            MINT_AMOUNT: process.env.MINT_AMOUNT || '2 (default)',
            DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET',
            STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY ? 'SET' : 'NOT SET'
        }
    };

    // Check database connection
    try {
        const dbConnected = await db.testConnection();
        healthData.database = {
            status: dbConnected ? 'connected' : 'disconnected',
            type: 'PostgreSQL'
        };
        
        if (dbConnected) {
            const stats = await db.getStats();
            healthData.database.stats = stats;
        }
    } catch (dbError) {
        healthData.database = {
            status: 'error',
            error: dbError.message
        };
    }

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

async function startServer() {
    try {
        // Initialize database
        await db.initDb();
        console.log('✅ PostgreSQL database initialized');
        
        // Initialize admin user
        await auth.initializeAdmin();
        
        return new Promise((resolve) => {
            const server = app.listen(PORT, () => {
                console.log('\n' + '='.repeat(50));
                console.log('  KEA VALLEY AUTO-MINTER');
                console.log('='.repeat(50));
                console.log(`  🌐 Server:    http://localhost:${PORT}`);
                console.log(`  📊 Dashboard: http://localhost:${PORT}/dashboard`);
                console.log(`  🎁 Claim:     http://localhost:${PORT}/claim`);
                console.log(`  👤 Profile:   http://localhost:${PORT}/profile`);
                console.log(`  💰 Presale:   http://localhost:${PORT}/presale`);
                console.log(`  💚 Health:    http://localhost:${PORT}/api/health`);
                console.log('='.repeat(50) + '\n');
                resolve(server);
            });
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        throw error;
    }
}

module.exports = { app, startServer };
