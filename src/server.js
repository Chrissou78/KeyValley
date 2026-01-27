const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./db-postgres');
const minter = require('./minter');
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
    enabled: process.env.PRESALE_ENABLED !== 'false',
    tokenPrice: parseFloat(process.env.PRESALE_TOKEN_PRICE) || 1.00, // EUR
    totalTokens: parseInt(process.env.PRESALE_TOTAL_TOKENS) || 1000000,
    minPurchase: parseInt(process.env.PRESALE_MIN_PURCHASE) || 10,
    maxPurchase: parseInt(process.env.PRESALE_MAX_PURCHASE) || 10000,
    presaleWallet: process.env.PRESALE_WALLET || '',
    tokenAddress: '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F',
    tokenDecimals: 18
};

// Load presale settings from DB on startup
async function loadPresaleSettings() {
    try {
        const result = await db.pool.query(
            "SELECT value FROM app_settings WHERE key = 'presale_config'"
        );
        if (result.rows.length > 0) {
            const saved = JSON.parse(result.rows[0].value);
            Object.assign(PRESALE_CONFIG, saved);
            console.log('✅ Loaded presale settings from DB');
        }
    } catch (e) {
        console.log('ℹ️ No saved presale settings, using defaults');
    }
}

// ===========================================
// Blockchain Constants
// ===========================================
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
const VIP_TOKEN_ADDRESS = '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

// Minimal ABIs
const VIP_TOKEN_ABI = [
    'function mint(address to, uint256 amount) external',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)'
];

const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// ===========================================
// Express App Setup
// ===========================================
const app = express();
const PORT = process.env.API_PORT || 3000;
const MINT_AMOUNT = parseInt(process.env.MINT_AMOUNT) || 2;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
// Admin Authentication Middleware (WalletTwo)
// ===========================================
async function requireAdminAuth(req, res, next) {
    const sessionId = req.cookies?.admin_session;
    
    if (!sessionId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    const session = await db.getSession(sessionId);
    if (!session) {
        res.clearCookie('admin_session', { path: '/' });
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Session expired' });
        }
        return res.redirect('/login');
    }
    
    const admin = await db.getAdminByEmail(session.username);
    if (!admin) {
        res.clearCookie('admin_session', { path: '/' });
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        return res.redirect('/login');
    }
    
    req.admin = admin;
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

// Login page - redirect to dashboard if already authenticated
app.get('/login', async (req, res) => {
    const sessionId = req.cookies?.admin_session;
    if (sessionId) {
        try {
            const session = await db.getSession(sessionId);
            if (session) {
                const admin = await db.getAdminByEmail(session.username);
                if (admin) {
                    return res.redirect('/dashboard');
                }
            }
        } catch (err) {
            console.error('Session check error:', err);
        }
    }
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

// ===========================================
// Protected Pages (Admin Auth Required)
// ===========================================

app.get('/dashboard', requireAdminAuth, (req, res) => {
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
        
        // Exchange code for access token
        const exchangeResponse = await fetch(`https://api.wallettwo.com/auth/consent?code=${code}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('📡 Exchange response status:', exchangeResponse.status);
        
        if (!exchangeResponse.ok) {
            const errorText = await exchangeResponse.text();
            console.error('❌ Exchange failed:', exchangeResponse.status, errorText);
            return res.status(exchangeResponse.status).json({ error: 'Exchange failed', details: errorText });
        }
        
        const tokenData = await exchangeResponse.json();
        console.log('✅ Token received:', Object.keys(tokenData));
        
        // Fetch user info with the token
        if (tokenData.access_token) {
            const userResponse = await fetch('https://api.wallettwo.com/auth/userinfo', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
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
// Admin Authentication API (WalletTwo)
// ===========================================

// Authenticate admin (called after WalletTwo login)
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { email, walletAddress, name } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }
        
        console.log('[Admin Auth] Checking:', email);
        
        // Check if email is whitelisted
        const isWhitelisted = await db.isAdminWhitelisted(email);
        
        if (!isWhitelisted) {
            console.log('[Admin Auth] Not whitelisted:', email);
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Your email is not authorized.' 
            });
        }
        
        // Update wallet address if provided
        if (walletAddress) {
            await db.updateAdminWallet(email, walletAddress);
        }
        
        // Update last login
        await db.updateAdminLastLogin(email);
        
        // Get admin info
        const admin = await db.getAdminByEmail(email);
        
        // Create session
        const sessionId = crypto.randomBytes(32).toString('hex');
        await db.createSession(sessionId, email, 24);
        
        console.log('[Admin Auth] Success:', email, admin.role);
        
        res.cookie('admin_session', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });
        
        res.json({
            success: true,
            admin: {
                email: admin.email,
                name: admin.name || name,
                role: admin.role,
                walletAddress: admin.wallet_address
            }
        });
        
    } catch (error) {
        console.error('[Admin Auth] Error:', error);
        res.status(500).json({ success: false, error: 'Authentication failed' });
    }
});

// Check admin session
app.get('/api/admin/session', async (req, res) => {
    try {
        const sessionId = req.cookies?.admin_session;
        
        if (!sessionId) {
            return res.json({ authenticated: false });
        }
        
        const session = await db.getSession(sessionId);
        
        if (!session) {
            res.clearCookie('admin_session', { path: '/' });
            return res.json({ authenticated: false });
        }
        
        const admin = await db.getAdminByEmail(session.username);
        
        if (!admin) {
            res.clearCookie('admin_session', { path: '/' });
            return res.json({ authenticated: false });
        }
        
        res.json({
            authenticated: true,
            admin: {
                email: admin.email,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        console.error('[Admin Session] Error:', error);
        res.json({ authenticated: false });
    }
});

// Admin logout
app.post('/api/admin/logout', async (req, res) => {
    const sessionId = req.cookies?.admin_session;
    if (sessionId) {
        await db.deleteSession(sessionId);
    }
    res.clearCookie('admin_session', { path: '/' });
    res.json({ success: true });
});

// Get all admins (super_admin only)
app.get('/api/admin/whitelist', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can view whitelist' });
        }
        const admins = await db.getAllAdmins();
        res.json({ success: true, admins });
    } catch (error) {
        console.error('Error getting admins:', error);
        res.status(500).json({ error: 'Failed to get admins' });
    }
});

// Add admin (super_admin only)
app.post('/api/admin/whitelist', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can add admins' });
        }
        const { email, name, role } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const admin = await db.addAdmin(email, name, role || 'admin', req.admin.email);
        res.json({ success: true, admin });
    } catch (error) {
        console.error('Error adding admin:', error);
        res.status(500).json({ error: 'Failed to add admin' });
    }
});

// Remove admin (super_admin only)
app.delete('/api/admin/whitelist/:email', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can remove admins' });
        }
        await db.removeAdmin(req.params.email);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing admin:', error);
        res.status(500).json({ error: error.message || 'Failed to remove admin' });
    }
});

// ===========================================
// Wallet Connection API (Profile page)
// ===========================================

app.post('/api/wallet/connect', async (req, res) => {
    try {
        const { walletAddress, email, name, source } = req.body;

        console.log('[Wallet Connect] Received:', { walletAddress, email, name, source });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid wallet address' 
            });
        }

        const normalizedAddress = walletAddress.toLowerCase();
        let registrant = await db.getRegistrant(normalizedAddress);

        if (registrant) {
            // Update existing
            if ((email && !registrant.email) || name) {
                try {
                    await db.pool.query(
                        `UPDATE registrants 
                         SET email = COALESCE($1, email),
                             metadata = jsonb_set(COALESCE(metadata, '{}'), '{name}', $2::jsonb),
                             updated_at = NOW() 
                         WHERE LOWER(address) = $3`,
                        [email || null, JSON.stringify(name || null), normalizedAddress]
                    );
                    console.log(`[Wallet Connect] Updated: ${normalizedAddress}, email: ${email}`);
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

        // Insert new
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
            console.log(`[Wallet Connect] Created: ${normalizedAddress}, email: ${email}`);
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
            createdAt: registrant.registered_at
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
// Protected API Endpoints (Admin Auth Required)
// ===========================================

app.post('/api/register', requireAdminAuth, async (req, res) => {
    const { wallet_address } = req.body;
    
    if (!wallet_address || !validateAddress(wallet_address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        const normalizedAddress = wallet_address.toLowerCase();
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

app.get('/api/registrants', requireAdminAuth, async (req, res) => {
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

app.get('/api/registrants/pending', requireAdminAuth, async (req, res) => {
    try {
        const registrants = await db.getPendingRegistrants();
        res.json({ registrants });
    } catch (error) {
        console.error('Error getting pending registrants:', error);
        res.status(500).json({ error: 'Failed to fetch pending registrants' });
    }
});

app.get('/api/registrants/:address', requireAdminAuth, async (req, res) => {
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

app.get('/api/stats', requireAdminAuth, async (req, res) => {
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

app.get('/api/wallet-info', requireAdminAuth, async (req, res) => {
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

app.get('/api/balance/:address', requireAdminAuth, async (req, res) => {
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

app.post('/api/mint-now', requireAdminAuth, async (req, res) => {
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

app.post('/api/sync', requireAdminAuth, async (req, res) => {
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

app.post('/api/full-sync', requireAdminAuth, async (req, res) => {
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';
        const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
        const VIP_TOKEN_ADDRESS = networkConfig.tokenAddress || '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
        const minterAddress = minter.wallet?.address || process.env.MINTER_ADDRESS || '';
        
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
        
        for (const registrant of registrants) {
            try {
                const balance = await minter.getBalance(registrant.address);
                const hasBalance = parseFloat(balance) > 0;
                
                if (hasBalance) {
                    results.withBalance++;
                } else {
                    results.withoutBalance++;
                }
                
                let txHash = registrant.tx_hash;
                let needsUpdate = false;
                
                const hasValidTxHash = txHash && 
                    txHash !== 'synced-from-chain' && 
                    txHash !== 'ALREADY_HAD_TOKENS' && 
                    txHash !== 'pre-existing' && 
                    txHash !== 'skipped' &&
                    txHash.startsWith('0x');
                
                if (hasBalance && !hasValidTxHash) {
                    try {
                        const apiUrl = `${POLYGONSCAN_API}?module=account&action=tokentx` +
                            `&contractaddress=${VIP_TOKEN_ADDRESS}` +
                            `&address=${registrant.address}` +
                            `&page=1&offset=100&sort=desc` +
                            (POLYGONSCAN_API_KEY ? `&apikey=${POLYGONSCAN_API_KEY}` : '');
                        
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        if (data.status === '1' && data.result && data.result.length > 0) {
                            let mintTx = null;
                            
                            if (minterAddress) {
                                mintTx = data.result.find(tx => 
                                    tx.from.toLowerCase() === minterAddress.toLowerCase() &&
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            if (!mintTx) {
                                mintTx = data.result.find(tx => 
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            if (mintTx && mintTx.hash) {
                                txHash = mintTx.hash;
                                results.txHashesFound++;
                                needsUpdate = true;
                            }
                        }
                    } catch (apiError) {
                        console.error(`Polygonscan API error for ${registrant.address}:`, apiError.message);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                
                if (hasBalance && !registrant.minted) {
                    await db.markAsMinted(registrant.address, txHash || 'synced-from-chain');
                    results.updated++;
                } else if (needsUpdate && txHash) {
                    await db.markAsMinted(registrant.address, txHash);
                    results.updated++;
                }
                
                results.registrants.push({
                    address: registrant.address,
                    email: registrant.email,
                    balance: balance,
                    minted: hasBalance || registrant.minted,
                    txHash: txHash || registrant.tx_hash,
                    registeredAt: registrant.registered_at
                });
                
            } catch (regError) {
                console.error(`Error processing ${registrant.address}:`, regError.message);
                results.registrants.push({
                    address: registrant.address,
                    email: registrant.email,
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
            message: `Full sync completed. Updated ${results.updated} records.`,
            results,
            stats,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
        
    } catch (error) {
        console.error('❌ Full sync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/mint-manual', requireAdminAuth, async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        const normalizedAddress = address.toLowerCase();
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        const mintAmount = parseInt(process.env.MINT_AMOUNT) || 2;
        
        const currentBalance = await minter.getBalance(normalizedAddress);
        if (parseFloat(currentBalance) >= mintAmount) {
            return res.json({
                success: false,
                message: `Wallet already has ${currentBalance} tokens`,
                address: normalizedAddress,
                balance: currentBalance
            });
        }
        
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===========================================
// Presale API Endpoints
// ===========================================

// Get presale config (public)
app.get('/api/presale/config', async (req, res) => {
    try {
        // Get tokens sold from DB
        let tokensSold = 0;
        try {
            const soldResult = await db.pool.query(
                "SELECT COALESCE(SUM(token_amount), 0) as sold FROM presale_purchases WHERE status IN ('paid', 'minted', 'completed')"
            );
            tokensSold = parseInt(soldResult.rows[0].sold) || 0;
        } catch (e) {
            console.log('Could not fetch tokens sold:', e.message);
        }

        // Fetch live EUR/USD rate
        let eurUsdRate = 1.19;
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            if (rateRes.ok) {
                const rateData = await rateRes.json();
                eurUsdRate = rateData.rates?.USD || 1.19;
            }
        } catch (e) {
            console.log('Using default EUR/USD rate');
        }

        // Fetch POL price in USD (correct CoinGecko endpoint)
        let polPrice = 0.12; // Default to current ~$0.12
        try {
            const polRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=polygon-ecosystem-token&vs_currencies=usd');
            if (polRes.ok) {
                const polData = await polRes.json();
                polPrice = polData['polygon-ecosystem-token']?.usd || 0.12;
                console.log('POL price fetched:', polPrice);
            }
        } catch (e) {
            console.log('Using default POL price:', polPrice);
        }

        res.json({
            enabled: PRESALE_CONFIG.enabled,
            tokenPrice: PRESALE_CONFIG.tokenPrice,
            totalTokens: PRESALE_CONFIG.totalTokens,
            tokensSold: tokensSold,
            minPurchase: PRESALE_CONFIG.minPurchase,
            maxPurchase: PRESALE_CONFIG.maxPurchase,
            presaleWallet: PRESALE_CONFIG.presaleWallet || process.env.PRESALE_WALLET || '',
            eurUsdRate: eurUsdRate,
            polPrice: polPrice
        });
    } catch (error) {
        console.error('Config error:', error);
        res.status(500).json({ error: 'Failed to load config' });
    }
});

// ===========================================
// Referral System API
// ===========================================

// Generate unique referral code
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,1,I)
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Get referral settings
async function getReferralSettings() {
    try {
        const result = await db.pool.query('SELECT setting_key, setting_value FROM referral_settings');
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        return {
            enabled: settings.enabled === 'true',
            claimBonusType: settings.claim_bonus_type || 'fixed',
            claimBonusAmount: parseFloat(settings.claim_bonus_amount) || 1,
            presaleBonusType: settings.presale_bonus_type || 'percentage',
            presaleBonusAmount: parseFloat(settings.presale_bonus_amount) || 5,
            autoPayBonus: settings.auto_pay_bonus === 'true',
            minPayoutThreshold: parseFloat(settings.min_payout_threshold) || 10
        };
    } catch (error) {
        console.error('Error getting referral settings:', error);
        return {
            enabled: false,
            claimBonusType: 'fixed',
            claimBonusAmount: 1,
            presaleBonusType: 'percentage',
            presaleBonusAmount: 5,
            autoPayBonus: false,
            minPayoutThreshold: 10
        };
    }
}

// Get or create referral code for a wallet
app.post('/api/referral/generate', async (req, res) => {
    try {
        const { walletAddress, email } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        const normalizedWallet = walletAddress.toLowerCase();
        
        // Check if user already has a code
        const existing = await db.pool.query(
            'SELECT * FROM referral_codes WHERE LOWER(owner_wallet) = $1',
            [normalizedWallet]
        );
        
        if (existing.rows.length > 0) {
            return res.json({
                success: true,
                referralCode: existing.rows[0].code,
                stats: {
                    totalReferrals: existing.rows[0].total_referrals,
                    totalClaims: existing.rows[0].total_claims,
                    totalPresalePurchases: existing.rows[0].total_presale_purchases,
                    totalBonusEarned: parseFloat(existing.rows[0].total_bonus_earned) || 0,
                    enabled: existing.rows[0].enabled
                }
            });
        }
        
        // Generate new code
        let code = generateReferralCode();
        let attempts = 0;
        
        // Ensure uniqueness
        while (attempts < 10) {
            const check = await db.pool.query('SELECT id FROM referral_codes WHERE code = $1', [code]);
            if (check.rows.length === 0) break;
            code = generateReferralCode();
            attempts++;
        }
        
        // Insert new referral code
        await db.pool.query(
            `INSERT INTO referral_codes (code, owner_wallet, owner_email, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [code, normalizedWallet, email || null]
        );
        
        console.log(`[Referral] Generated code ${code} for ${normalizedWallet}`);
        
        res.json({
            success: true,
            referralCode: code,
            stats: {
                totalReferrals: 0,
                totalClaims: 0,
                totalPresalePurchases: 0,
                totalBonusEarned: 0,
                enabled: true
            }
        });
        
    } catch (error) {
        console.error('[Referral] Generate error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate referral code' });
    }
});

// Get referral code info (for displaying in profile)
app.get('/api/referral/code/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet || !ethers.isAddress(wallet)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        const result = await db.pool.query(
            'SELECT * FROM referral_codes WHERE LOWER(owner_wallet) = $1',
            [wallet.toLowerCase()]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: true, hasCode: false });
        }
        
        const code = result.rows[0];
        
        // Get recent referrals
        const referrals = await db.pool.query(
            `SELECT referred_wallet, referred_email, source, bonus_amount, bonus_paid, created_at
             FROM referral_tracking
             WHERE referral_code = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [code.code]
        );
        
        res.json({
            success: true,
            hasCode: true,
            referralCode: code.code,
            enabled: code.enabled,
            stats: {
                totalReferrals: code.total_referrals,
                totalClaims: code.total_claims,
                totalPresalePurchases: code.total_presale_purchases,
                totalBonusEarned: parseFloat(code.total_bonus_earned) || 0
            },
            recentReferrals: referrals.rows
        });
        
    } catch (error) {
        console.error('[Referral] Get code error:', error);
        res.status(500).json({ success: false, error: 'Failed to get referral code' });
    }
});

// Validate referral code (used by claim/presale pages)
app.get('/api/referral/validate/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        if (!code || code.length < 6) {
            return res.json({ success: true, valid: false });
        }
        
        const settings = await getReferralSettings();
        
        if (!settings.enabled) {
            return res.json({ success: true, valid: false, reason: 'Referral program disabled' });
        }
        
        const result = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1) AND enabled = true',
            [code]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: true, valid: false, reason: 'Code not found or disabled' });
        }
        
        res.json({
            success: true,
            valid: true,
            referrerWallet: result.rows[0].owner_wallet
        });
        
    } catch (error) {
        console.error('[Referral] Validate error:', error);
        res.json({ success: true, valid: false });
    }
});

// Track referral (called when someone registers/purchases with a referral code)
app.post('/api/referral/track', async (req, res) => {
    try {
        const { referralCode, referredWallet, referredEmail, source, purchaseAmount } = req.body;
        
        if (!referralCode || !referredWallet) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const settings = await getReferralSettings();
        
        if (!settings.enabled) {
            return res.json({ success: false, error: 'Referral program disabled' });
        }
        
        // Get referral code info
        const codeResult = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1) AND enabled = true',
            [referralCode]
        );
        
        if (codeResult.rows.length === 0) {
            return res.json({ success: false, error: 'Invalid referral code' });
        }
        
        const referrerWallet = codeResult.rows[0].owner_wallet;
        
        // Prevent self-referral
        if (referredWallet.toLowerCase() === referrerWallet.toLowerCase()) {
            return res.json({ success: false, error: 'Cannot use own referral code' });
        }
        
        // Check if already referred
        const existingReferral = await db.pool.query(
            'SELECT id FROM referral_tracking WHERE LOWER(referred_wallet) = $1 AND source = $2',
            [referredWallet.toLowerCase(), source]
        );
        
        if (existingReferral.rows.length > 0) {
            return res.json({ success: false, error: 'Wallet already referred for this action' });
        }
        
        // Calculate bonus
        let bonusType, bonusAmount;
        if (source === 'claim') {
            bonusType = settings.claimBonusType;
            bonusAmount = settings.claimBonusAmount;
        } else if (source === 'presale') {
            bonusType = settings.presaleBonusType;
            if (bonusType === 'percentage' && purchaseAmount) {
                bonusAmount = (purchaseAmount * settings.presaleBonusAmount) / 100;
            } else {
                bonusAmount = settings.presaleBonusAmount;
            }
        }
        
        // Insert tracking record
        await db.pool.query(
            `INSERT INTO referral_tracking 
             (referral_code, referred_wallet, referred_email, referrer_wallet, source, bonus_type, bonus_amount, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [referralCode.toUpperCase(), referredWallet.toLowerCase(), referredEmail, referrerWallet, source, bonusType, bonusAmount]
        );
        
        // Update referral code stats
        const updateField = source === 'claim' ? 'total_claims' : 'total_presale_purchases';
        await db.pool.query(
            `UPDATE referral_codes 
             SET total_referrals = total_referrals + 1,
                 ${updateField} = ${updateField} + 1,
                 total_bonus_earned = total_bonus_earned + $1,
                 updated_at = NOW()
             WHERE UPPER(code) = UPPER($2)`,
            [bonusAmount, referralCode]
        );
        
        console.log(`[Referral] Tracked: ${referredWallet} via ${referralCode}, bonus: ${bonusAmount} VIP`);
        
        res.json({
            success: true,
            bonusAmount,
            bonusType,
            referrerWallet
        });
        
    } catch (error) {
        console.error('[Referral] Track error:', error);
        res.status(500).json({ success: false, error: 'Failed to track referral' });
    }
});

// Get referral settings (public - limited info)
app.get('/api/referral/settings', async (req, res) => {
    try {
        const settings = await getReferralSettings();
        res.json({
            success: true,
            enabled: settings.enabled,
            claimBonus: {
                type: settings.claimBonusType,
                amount: settings.claimBonusAmount
            },
            presaleBonus: {
                type: settings.presaleBonusType,
                amount: settings.presaleBonusAmount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get settings' });
    }
});

// ===========================================
// Admin Referral Endpoints
// ===========================================

// Get all referral codes (admin)
app.get('/api/admin/referrals', requireAdminAuth, async (req, res) => {
    try {
        const codes = await db.pool.query(
            `SELECT rc.*, 
                    (SELECT COUNT(*) FROM referral_tracking WHERE referral_code = rc.code) as referral_count
             FROM referral_codes rc
             ORDER BY rc.created_at DESC
             LIMIT 100`
        );
        
        const settings = await getReferralSettings();
        
        // Get overall stats
        const stats = await db.pool.query(`
            SELECT 
                COUNT(DISTINCT referral_code) as active_codes,
                COUNT(*) as total_referrals,
                SUM(CASE WHEN source = 'claim' THEN 1 ELSE 0 END) as claim_referrals,
                SUM(CASE WHEN source = 'presale' THEN 1 ELSE 0 END) as presale_referrals,
                SUM(bonus_amount) as total_bonus_owed,
                SUM(CASE WHEN bonus_paid THEN bonus_amount ELSE 0 END) as total_bonus_paid
            FROM referral_tracking
        `);
        
        res.json({
            success: true,
            codes: codes.rows,
            settings,
            stats: stats.rows[0]
        });
    } catch (error) {
        console.error('[Admin Referral] Get all error:', error);
        res.status(500).json({ success: false, error: 'Failed to get referrals' });
    }
});

// Update referral settings (admin)
app.post('/api/admin/referrals/settings', requireAdminAuth, async (req, res) => {
    try {
        const { enabled, claimBonusType, claimBonusAmount, presaleBonusType, presaleBonusAmount, autoPayBonus, minPayoutThreshold } = req.body;
        
        const updates = [
            ['enabled', String(enabled)],
            ['claim_bonus_type', claimBonusType],
            ['claim_bonus_amount', String(claimBonusAmount)],
            ['presale_bonus_type', presaleBonusType],
            ['presale_bonus_amount', String(presaleBonusAmount)],
            ['auto_pay_bonus', String(autoPayBonus)],
            ['min_payout_threshold', String(minPayoutThreshold)]
        ];
        
        for (const [key, value] of updates) {
            if (value !== undefined) {
                await db.pool.query(
                    `INSERT INTO referral_settings (setting_key, setting_value, updated_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()`,
                    [key, value]
                );
            }
        }
        
        console.log('[Admin Referral] Settings updated');
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Admin Referral] Update settings error:', error);
        res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
});

// Enable/disable a referral code (admin)
app.post('/api/admin/referrals/toggle/:code', requireAdminAuth, async (req, res) => {
    try {
        const { code } = req.params;
        const { enabled } = req.body;
        
        await db.pool.query(
            'UPDATE referral_codes SET enabled = $1, updated_at = NOW() WHERE UPPER(code) = UPPER($2)',
            [enabled, code]
        );
        
        console.log(`[Admin Referral] Code ${code} ${enabled ? 'enabled' : 'disabled'}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('[Admin Referral] Toggle error:', error);
        res.status(500).json({ success: false, error: 'Failed to toggle code' });
    }
});

// Get referral details for a specific code (admin)
app.get('/api/admin/referrals/:code', requireAdminAuth, async (req, res) => {
    try {
        const { code } = req.params;
        
        const codeResult = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1)',
            [code]
        );
        
        if (codeResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Code not found' });
        }
        
        const referrals = await db.pool.query(
            `SELECT * FROM referral_tracking WHERE referral_code = $1 ORDER BY created_at DESC`,
            [code.toUpperCase()]
        );
        
        res.json({
            success: true,
            code: codeResult.rows[0],
            referrals: referrals.rows
        });
    } catch (error) {
        console.error('[Admin Referral] Get details error:', error);
        res.status(500).json({ success: false, error: 'Failed to get details' });
    }
});

// Pay out referral bonus (admin manual action)
app.post('/api/admin/referrals/payout', requireAdminAuth, async (req, res) => {
    try {
        const { referrerWallet, amount } = req.body;
        
        if (!referrerWallet || !amount) {
            return res.status(400).json({ success: false, error: 'Missing wallet or amount' });
        }
        
        // Mint bonus tokens to referrer
        const mintResult = await mintPresaleTokens(referrerWallet, amount);
        
        if (mintResult.success) {
            // Mark bonuses as paid
            await db.pool.query(
                `UPDATE referral_tracking 
                 SET bonus_paid = true, bonus_tx_hash = $1
                 WHERE LOWER(referrer_wallet) = LOWER($2) AND bonus_paid = false`,
                [mintResult.txHash, referrerWallet]
            );
            
            res.json({
                success: true,
                txHash: mintResult.txHash,
                amount
            });
        } else {
            res.status(500).json({ success: false, error: mintResult.error || 'Minting failed' });
        }
    } catch (error) {
        console.error('[Admin Referral] Payout error:', error);
        res.status(500).json({ success: false, error: 'Failed to process payout' });
    }
});

// ============================================
// SIMPLIFIED REFERRAL SYSTEM
// ============================================

// POST /api/referral/set - Set referrer for a user (one-time only)
app.post('/api/referral/set', async (req, res) => {
    try {
        const { walletAddress, referralCode } = req.body;
        
        if (!walletAddress || !referralCode) {
            return res.status(400).json({ error: 'Wallet address and referral code required' });
        }
        
        const wallet = walletAddress.toLowerCase();
        const code = referralCode.toUpperCase().trim();
        
        // Check if user already has a referrer
        const existingReferrer = await db.query(
            'SELECT referrer_wallet FROM registrants WHERE LOWER(address) = $1 AND referrer_wallet IS NOT NULL',
            [wallet]
        );
        
        if (existingReferrer.rows.length > 0 && existingReferrer.rows[0].referrer_wallet) {
            return res.status(400).json({ error: 'You have already set a referrer. This cannot be changed.' });
        }
        
        // Validate the referral code exists and is active
        const codeResult = await db.query(
            'SELECT wallet_address, enabled FROM referral_codes WHERE code = $1',
            [code]
        );
        
        if (codeResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid referral code' });
        }
        
        if (!codeResult.rows[0].enabled) {
            return res.status(400).json({ error: 'This referral code is no longer active' });
        }
        
        const referrerWallet = codeResult.rows[0].wallet_address.toLowerCase();
        
        // Prevent self-referral
        if (referrerWallet === wallet) {
            return res.status(400).json({ error: 'You cannot use your own referral code' });
        }
        
        // Get user's email if available
        const userResult = await db.query(
            'SELECT email FROM registrants WHERE LOWER(address) = $1',
            [wallet]
        );
        const userEmail = userResult.rows[0]?.email || null;
        
        // Update registrant with referrer info
        await db.query(
            `UPDATE registrants 
             SET referrer_wallet = $1, referrer_code = $2, referrer_set_at = NOW(), updated_at = NOW()
             WHERE LOWER(address) = $3`,
            [referrerWallet, code, wallet]
        );
        
        // Create referral record
        await db.query(
            `INSERT INTO referrals (referrer_wallet, referrer_code, referee_wallet, referee_email, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (referee_wallet) DO NOTHING`,
            [referrerWallet, code, wallet, userEmail]
        );
        
        // Check referral settings for signup bonus
        const settingsResult = await db.query('SELECT * FROM referral_settings WHERE id = 1');
        const settings = settingsResult.rows[0];
        
        let signupBonus = 0;
        if (settings && settings.enabled && settings.bonus_type === 'fixed') {
            signupBonus = parseFloat(settings.bonus_amount);
            
            // Record the signup bonus
            await db.query(
                'UPDATE referrals SET signup_bonus_paid = $1 WHERE referee_wallet = $2',
                [signupBonus, wallet]
            );
            
            // TODO: Actually mint/transfer the bonus tokens to referrer
            console.log(`Signup bonus of ${signupBonus} VIP to be paid to ${referrerWallet}`);
        }
        
        res.json({ 
            success: true, 
            message: 'Referrer set successfully',
            referrerWallet: referrerWallet.substring(0, 6) + '...' + referrerWallet.substring(referrerWallet.length - 4),
            signupBonus: signupBonus
        });
        
    } catch (error) {
        console.error('Error setting referrer:', error);
        res.status(500).json({ error: 'Failed to set referrer' });
    }
});

// GET /api/referral/status/:wallet - Get referral status for a user
app.get('/api/referral/status/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        
        // Get user's referrer info
        const userResult = await db.query(
            `SELECT referrer_wallet, referrer_code, referrer_set_at 
             FROM registrants WHERE LOWER(address) = $1`,
            [wallet]
        );
        
        // Get user's own referral code if they have one
        const codeResult = await db.query(
            'SELECT code, enabled, created_at FROM referral_codes WHERE LOWER(wallet_address) = $1',
            [wallet]
        );
        
        // Get referral stats if user has a code
        let referralStats = { totalReferrals: 0, totalBonusEarned: 0 };
        if (codeResult.rows.length > 0) {
            const statsResult = await db.query(
                `SELECT COUNT(*) as total_referrals, 
                        COALESCE(SUM(signup_bonus_paid + presale_bonus_paid), 0) as total_bonus
                 FROM referrals WHERE referrer_wallet = $1`,
                [wallet]
            );
            referralStats = {
                totalReferrals: parseInt(statsResult.rows[0].total_referrals),
                totalBonusEarned: parseFloat(statsResult.rows[0].total_bonus)
            };
        }
        
        // Get referral settings for display
        const settingsResult = await db.query('SELECT * FROM referral_settings WHERE id = 1');
        const settings = settingsResult.rows[0] || {};
        
        res.json({
            hasReferrer: !!(userResult.rows[0]?.referrer_wallet),
            referrerWallet: userResult.rows[0]?.referrer_wallet || null,
            referrerCode: userResult.rows[0]?.referrer_code || null,
            referrerSetAt: userResult.rows[0]?.referrer_set_at || null,
            myCode: codeResult.rows[0]?.code || null,
            myCodeEnabled: codeResult.rows[0]?.enabled ?? null,
            myCodeCreatedAt: codeResult.rows[0]?.created_at || null,
            stats: referralStats,
            programEnabled: settings.enabled ?? false,
            bonusInfo: {
                signupType: settings.bonus_type || 'fixed',
                signupAmount: parseFloat(settings.bonus_amount) || 0,
                presaleType: settings.presale_bonus_type || 'percentage',
                presaleAmount: parseFloat(settings.presale_bonus_amount) || 0
            }
        });
        
    } catch (error) {
        console.error('Error getting referral status:', error);
        res.status(500).json({ error: 'Failed to get referral status' });
    }
});

// POST /api/referral/generate - Generate referral code for user
app.post('/api/referral/generate', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }
        
        const wallet = walletAddress.toLowerCase();
        
        // Check if referral program is enabled
        const settingsResult = await db.query('SELECT enabled FROM referral_settings WHERE id = 1');
        if (!settingsResult.rows[0]?.enabled) {
            return res.status(400).json({ error: 'Referral program is currently disabled' });
        }
        
        // Check if user already has a code
        const existingCode = await db.query(
            'SELECT code FROM referral_codes WHERE LOWER(wallet_address) = $1',
            [wallet]
        );
        
        if (existingCode.rows.length > 0) {
            return res.json({ 
                success: true, 
                code: existingCode.rows[0].code,
                message: 'You already have a referral code'
            });
        }
        
        // Generate unique code
        const generateCode = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        };
        
        let code;
        let attempts = 0;
        while (attempts < 10) {
            code = generateCode();
            const exists = await db.query('SELECT 1 FROM referral_codes WHERE code = $1', [code]);
            if (exists.rows.length === 0) break;
            attempts++;
        }
        
        if (attempts >= 10) {
            return res.status(500).json({ error: 'Failed to generate unique code, please try again' });
        }
        
        // Insert the code
        await db.query(
            'INSERT INTO referral_codes (wallet_address, code, enabled, created_at) VALUES ($1, $2, true, NOW())',
            [wallet, code]
        );
        
        res.json({ 
            success: true, 
            code: code,
            message: 'Referral code generated successfully'
        });
        
    } catch (error) {
        console.error('Error generating referral code:', error);
        res.status(500).json({ error: 'Failed to generate referral code' });
    }
});

// Update admin stats endpoint to include separated bonuses
app.get('/api/admin/referral/stats', requireAdminAuth, async (req, res) => {
    try {
        const codesResult = await db.query('SELECT COUNT(*) as count FROM referral_codes WHERE enabled = true');
        const referralsResult = await db.query('SELECT COUNT(*) as count FROM referrals');
        const signupBonusResult = await db.query('SELECT COALESCE(SUM(signup_bonus_paid), 0) as total FROM referrals');
        const presaleBonusResult = await db.query('SELECT COALESCE(SUM(presale_bonus_paid), 0) as total FROM referrals');
        
        res.json({
            totalCodes: parseInt(codesResult.rows[0].count),
            totalReferrals: parseInt(referralsResult.rows[0].count),
            totalSignupBonus: parseFloat(signupBonusResult.rows[0].total),
            totalPresaleBonus: parseFloat(presaleBonusResult.rows[0].total)
        });
    } catch (error) {
        console.error('Error fetching referral stats:', error);
        res.status(500).json({ error: 'Failed to fetch referral stats' });
    }
});

// ===========================================
// Presale Payment Verification & Auto-Mint
// ===========================================

// Verify payment transaction on-chain
async function verifyTransaction(txHash, expectedFrom, expectedUSD, paymentMethod) {
    try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (!tx || !receipt) {
            return { success: false, error: 'Transaction not found' };
        }
        
        if (receipt.status !== 1) {
            return { success: false, error: 'Transaction failed on-chain' };
        }
        
        // Verify sender
        if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
            return { success: false, error: 'Transaction sender mismatch' };
        }
        
        // Verify recipient is presale wallet
        const presaleWallet = (PRESALE_CONFIG.presaleWallet || process.env.PRESALE_WALLET || '').toLowerCase();
        
        if (!presaleWallet) {
            console.log('⚠️ No presale wallet configured, skipping recipient check');
            return { success: true };
        }
        
        if (paymentMethod === 'POL') {
            // Native transfer - check tx.to and tx.value
            if (tx.to && tx.to.toLowerCase() !== presaleWallet) {
                return { success: false, error: 'Payment not sent to presale wallet' };
            }
        } else if (paymentMethod === 'USDC') {
            // ERC20 transfer - check logs for Transfer event
            const erc20Interface = new ethers.Interface(ERC20_ABI);
            let foundTransfer = false;
            
            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
                    try {
                        const parsed = erc20Interface.parseLog({
                            topics: log.topics,
                            data: log.data
                        });
                        if (parsed && parsed.name === 'Transfer') {
                            const to = parsed.args[1].toLowerCase();
                            if (to === presaleWallet) {
                                foundTransfer = true;
                                break;
                            }
                        }
                    } catch (e) {
                        // Not a Transfer event, continue
                    }
                }
            }
            
            if (!foundTransfer) {
                return { success: false, error: 'USDC transfer to presale wallet not found' };
            }
        }
        
        return { success: true };
    } catch (error) {
        console.error('TX verification error:', error);
        return { success: false, error: 'Verification failed: ' + error.message };
    }
}

// Mint tokens using owner wallet
async function mintPresaleTokens(toAddress, amount) {
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    
    if (!PRIVATE_KEY) {
        console.error('❌ PRIVATE_KEY not configured for presale minting');
        return { success: false, error: 'Minting not configured' };
    }
    
    try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const tokenContract = new ethers.Contract(VIP_TOKEN_ADDRESS, VIP_TOKEN_ABI, wallet);
        
        // Convert amount to wei (18 decimals)
        const amountWei = ethers.parseUnits(amount.toString(), 18);
        
        console.log(`🎯 Presale minting ${amount} VIP tokens to ${toAddress}`);
        
        // Estimate gas
        const gasEstimate = await tokenContract.mint.estimateGas(toAddress, amountWei);
        const feeData = await provider.getFeeData();
        
        // Send mint transaction
        const tx = await tokenContract.mint(toAddress, amountWei, {
            gasLimit: gasEstimate * 120n / 100n, // 20% buffer
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        });
        
        console.log(`📤 Presale mint TX sent: ${tx.hash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log(`✅ Presale mint confirmed: ${tx.hash}`);
            return { success: true, txHash: tx.hash };
        } else {
            return { success: false, error: 'Mint transaction failed' };
        }
    } catch (error) {
        console.error('❌ Presale mint error:', error);
        return { success: false, error: error.message };
    }
}

// Verify payment and mint tokens endpoint
app.post('/api/presale/verify-payment', async (req, res) => {
    const { txHash, walletAddress, tokenAmount, totalEUR, totalUSD, paymentMethod } = req.body;
    
    console.log('💰 Presale payment verification:', { txHash, walletAddress, tokenAmount, paymentMethod });
    
    if (!txHash || !walletAddress || !tokenAmount) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    if (!ethers.isAddress(walletAddress)) {
        return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    try {
        // Check if TX already processed
        const existing = await db.pool.query(
            'SELECT id FROM presale_purchases WHERE payment_tx_hash = $1',
            [txHash]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Transaction already processed' });
        }
        
        // Verify transaction on-chain
        console.log('🔍 Verifying transaction on-chain...');
        const txVerified = await verifyTransaction(txHash, walletAddress, totalUSD, paymentMethod);
        
        if (!txVerified.success) {
            console.log('❌ TX verification failed:', txVerified.error);
            return res.status(400).json({ success: false, error: txVerified.error || 'Transaction verification failed' });
        }
        
        console.log('✅ Transaction verified successfully');
        
        // Record purchase as paid
        const purchaseResult = await db.pool.query(`
            INSERT INTO presale_purchases 
            (wallet_address, token_amount, eur_amount, usd_amount, payment_method, payment_tx_hash, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'paid', NOW())
            RETURNING id
        `, [walletAddress.toLowerCase(), tokenAmount, totalEUR || 0, totalUSD || 0, paymentMethod, txHash]);
        
        const purchaseId = purchaseResult.rows[0].id;
        console.log('📝 Purchase recorded with ID:', purchaseId);
        
        // Mint tokens to user
        console.log('🎯 Initiating token mint...');
        const mintResult = await mintPresaleTokens(walletAddress, tokenAmount);
        
        if (mintResult.success) {
            // Update purchase with mint TX
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', mint_tx_hash = $1, minted_at = NOW()
                WHERE id = $2
            `, [mintResult.txHash, purchaseId]);
            
            console.log('✅ Presale purchase completed successfully');
            
            res.json({
                success: true,
                mintTxHash: mintResult.txHash,
                message: 'Tokens minted successfully'
            });
        } else {
            // Update status to pending_mint for manual retry
            await db.pool.query(`
                UPDATE presale_purchases SET status = 'pending_mint' WHERE id = $1
            `, [purchaseId]);
            
            console.log('⚠️ Minting failed, marked for manual retry');
            
            res.status(500).json({
                success: false,
                error: 'Minting failed. Payment received - tokens will be sent manually.',
                purchaseId
            });
        }
    } catch (error) {
        console.error('❌ Verify payment error:', error);
        res.status(500).json({ success: false, error: 'Server error during verification' });
    }
});

// Get purchases for a wallet (JSON)
app.get('/api/presale/purchases/:address', async (req, res) => {
    try {
        const { address } = req.params;
        
        if (!address || !ethers.isAddress(address)) {
            return res.json({ success: true, purchases: [] });
        }
        
        const result = await db.pool.query(`
            SELECT id, token_amount, eur_amount, usd_amount, payment_method, 
                   payment_tx_hash, mint_tx_hash, status, created_at, minted_at
            FROM presale_purchases 
            WHERE LOWER(wallet_address) = LOWER($1)
            ORDER BY created_at DESC
        `, [address]);
        
        res.json({
            success: true,
            purchases: result.rows
        });
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.json({ success: true, purchases: [] });
    }
});

// Legacy endpoint for backward compatibility
app.post('/api/presale/purchase', async (req, res) => {
    try {
        const { wallet_address, token_amount, payment_method, payment_amount } = req.body;
        
        if (!wallet_address || !ethers.isAddress(wallet_address)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!token_amount || token_amount < PRESALE_CONFIG.minPurchase || token_amount > PRESALE_CONFIG.maxPurchase) {
            return res.status(400).json({ error: 'Invalid token amount' });
        }
        
        const normalizedAddress = wallet_address.toLowerCase();
        const usdAmount = token_amount * PRESALE_CONFIG.tokenPrice;
        
        let purchase = { id: Date.now() };
        try {
            purchase = await db.addPresalePurchase({
                wallet_address: normalizedAddress,
                token_amount,
                payment_method,
                payment_amount,
                usd_amount: usdAmount,
                status: 'pending_payment'
            });
        } catch (e) {
            console.log('Could not save purchase:', e.message);
        }
        
        res.json({
            success: true,
            purchase_id: purchase.id,
            message: 'Purchase recorded.',
            payment_wallet: PRESALE_CONFIG.presaleWallet || process.env.PRESALE_WALLET || 'Contact support'
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Purchase failed' });
    }
});

// Stripe checkout (disabled but kept for compatibility)
app.post('/api/presale/create-checkout', async (req, res) => {
    return res.status(503).json({ error: 'Card payments not available. Please use crypto (POL or USDC).' });
});

// ===========================================
// Admin Presale Endpoints
// ===========================================

// Get admin settings
app.get('/api/presale/admin/settings', requireAdminAuth, async (req, res) => {
    res.json({
        success: true,
        settings: {
            enabled: PRESALE_CONFIG.enabled,
            tokenPrice: PRESALE_CONFIG.tokenPrice,
            totalTokens: PRESALE_CONFIG.totalTokens,
            minPurchase: PRESALE_CONFIG.minPurchase,
            maxPurchase: PRESALE_CONFIG.maxPurchase,
            presaleWallet: PRESALE_CONFIG.presaleWallet || process.env.PRESALE_WALLET || ''
        }
    });
});

// Update admin settings
app.post('/api/presale/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const { enabled, tokenPrice, totalTokens, minPurchase, maxPurchase, presaleWallet } = req.body;
        
        // Update in-memory config
        if (typeof enabled === 'boolean') PRESALE_CONFIG.enabled = enabled;
        if (tokenPrice !== undefined) PRESALE_CONFIG.tokenPrice = parseFloat(tokenPrice);
        if (totalTokens !== undefined) PRESALE_CONFIG.totalTokens = parseInt(totalTokens);
        if (minPurchase !== undefined) PRESALE_CONFIG.minPurchase = parseInt(minPurchase);
        if (maxPurchase !== undefined) PRESALE_CONFIG.maxPurchase = parseInt(maxPurchase);
        if (presaleWallet !== undefined) PRESALE_CONFIG.presaleWallet = presaleWallet;
        
        // Persist to DB
        try {
            await db.pool.query(`
                INSERT INTO app_settings (key, value, updated_at) 
                VALUES ('presale_config', $1, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
            `, [JSON.stringify({
                enabled: PRESALE_CONFIG.enabled,
                tokenPrice: PRESALE_CONFIG.tokenPrice,
                totalTokens: PRESALE_CONFIG.totalTokens,
                minPurchase: PRESALE_CONFIG.minPurchase,
                maxPurchase: PRESALE_CONFIG.maxPurchase,
                presaleWallet: PRESALE_CONFIG.presaleWallet
            })]);
            console.log('✅ Presale settings saved to DB');
        } catch (dbError) {
            console.log('⚠️ Could not persist settings to DB:', dbError.message);
        }
        
        console.log('✅ Presale settings updated:', PRESALE_CONFIG);
        
        res.json({ success: true, settings: PRESALE_CONFIG });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Admin stats
app.get('/api/presale/admin/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.pool.query(`
            SELECT 
                COUNT(*) as total_purchases,
                COUNT(DISTINCT wallet_address) as unique_buyers,
                COALESCE(SUM(token_amount), 0) as total_tokens,
                COALESCE(SUM(usd_amount), 0) as total_usd,
                COALESCE(SUM(eur_amount), 0) as total_eur,
                COUNT(CASE WHEN status = 'pending_mint' THEN 1 END) as pending_mint
            FROM presale_purchases
            WHERE status IN ('paid', 'pending_mint', 'completed', 'minted')
        `);
        
        res.json({
            success: true,
            stats: stats.rows[0]
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Admin purchases list
app.get('/api/presale/admin/purchases', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT p.*, r.email
            FROM presale_purchases p
            LEFT JOIN registrants r ON LOWER(p.wallet_address) = LOWER(r.address)
            ORDER BY p.created_at DESC
            LIMIT 100
        `);
        
        res.json({
            success: true,
            purchases: result.rows,
            config: PRESALE_CONFIG
        });
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

// Admin fulfill (manual mint for pending purchases)
app.post('/api/presale/admin/fulfill', requireAdminAuth, async (req, res) => {
    try {
        const { purchase_id } = req.body;
        
        const purchaseResult = await db.pool.query(
            'SELECT * FROM presale_purchases WHERE id = $1',
            [purchase_id]
        );
        
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase not found' });
        }
        
        const purchase = purchaseResult.rows[0];
        
        if (purchase.status === 'completed' || purchase.status === 'minted') {
            return res.status(400).json({ error: 'Already fulfilled' });
        }
        
        // Mint tokens
        const mintResult = await mintPresaleTokens(purchase.wallet_address, purchase.token_amount);
        
        if (mintResult.success) {
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', mint_tx_hash = $1, minted_at = NOW()
                WHERE id = $2
            `, [mintResult.txHash, purchase_id]);
            
            res.json({
                success: true,
                tx_hash: mintResult.txHash,
                explorer_url: `https://polygonscan.com/tx/${mintResult.txHash}`
            });
        } else {
            res.status(500).json({ error: mintResult.error || 'Minting failed' });
        }
    } catch (error) {
        console.error('Fulfill error:', error);
        res.status(500).json({ error: error.message });
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
        presale: {
            enabled: PRESALE_CONFIG.enabled,
            tokenPrice: PRESALE_CONFIG.tokenPrice + ' EUR',
            presaleWallet: PRESALE_CONFIG.presaleWallet ? 'configured' : 'not set'
        },
        env: {
            NETWORK: process.env.NETWORK ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON ? 'SET' : 'NOT SET',
            PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'NOT SET',
            PRESALE_WALLET: process.env.PRESALE_WALLET ? 'SET' : 'NOT SET',
            MINT_AMOUNT: process.env.MINT_AMOUNT || '2 (default)',
            DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET'
        }
    };

    try {
        const dbConnected = await db.testConnection();
        healthData.database = { status: dbConnected ? 'connected' : 'disconnected', type: 'PostgreSQL' };
        if (dbConnected) {
            healthData.database.stats = await db.getStats();
        }
    } catch (dbError) {
        healthData.database = { status: 'error', error: dbError.message };
    }

    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        healthData.minter = {
            status: 'initialized',
            wallet: minter.wallet.address,
            tokenAddress: networkConfig.tokenAddress,
            network: networkConfig.name
        };
    } catch (error) {
        healthData.minter = { status: 'error', error: error.message };
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
        await db.initDb();
        console.log('✅ PostgreSQL database initialized');
        
        // Load presale settings from DB
        await loadPresaleSettings();
        
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
                console.log(`  🔐 Login:     http://localhost:${PORT}/login`);
                console.log('='.repeat(50));
                console.log(`  💎 Presale:   ${PRESALE_CONFIG.enabled ? 'ENABLED' : 'DISABLED'}`);
                console.log(`  💵 Price:     €${PRESALE_CONFIG.tokenPrice}`);
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
