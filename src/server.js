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
        const { minter, networkConfig } = await initializeMinter();
        
        // Get Polygonscan API key from env (optional but recommended for higher rate limits)
        const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';
        const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
        const VIP_TOKEN_ADDRESS = '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
        
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
                
                // If has balance but no tx hash, try to find the mint transaction
                if (hasBalance && !txHash) {
                    try {
                        // Query Polygonscan for token transfers TO this address FROM our minter wallet
                        const minterAddress = networkConfig.minterAddress || process.env.MINTER_ADDRESS;
                        
                        const apiUrl = `${POLYGONSCAN_API}?module=account&action=tokentx` +
                            `&contractaddress=${VIP_TOKEN_ADDRESS}` +
                            `&address=${registrant.address}` +
                            `&page=1&offset=100&sort=desc` +
                            (POLYGONSCAN_API_KEY ? `&apikey=${POLYGONSCAN_API_KEY}` : '');
                        
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        if (data.status === '1' && data.result && data.result.length > 0) {
                            // Find transfers from the minter wallet to this address
                            const mintTx = data.result.find(tx => 
                                tx.from.toLowerCase() === minterAddress?.toLowerCase() ||
                                tx.to.toLowerCase() === registrant.address.toLowerCase()
                            );
                            
                            if (mintTx) {
                                txHash = mintTx.hash;
                                results.txHashesFound++;
                            }
                        }
                    } catch (apiError) {
                        console.error(`Error fetching tx for ${registrant.address}:`, apiError.message);
                    }
                }
                
                // Update DB if needed
                if (hasBalance && !registrant.minted) {
                    await db.markAsMinted(registrant.address, txHash || 'synced-from-chain');
                    results.updated++;
                } else if (hasBalance && txHash && txHash !== registrant.tx_hash) {
                    // Update tx hash if we found a new one
                    await db.markAsMinted(registrant.address, txHash);
                }
                
                results.registrants.push({
                    address: registrant.address,
                    balance: balance,
                    minted: hasBalance || registrant.minted,
                    txHash: txHash || registrant.tx_hash,
                    registeredAt: registrant.registered_at
                });
                
            } catch (regError) {
                console.error(`Error processing ${registrant.address}:`, regError.message);
                results.registrants.push({
                    address: registrant.address,
                    balance: '0',
                    minted: registrant.minted,
                    txHash: registrant.tx_hash,
                    registeredAt: registrant.registered_at,
                    error: regError.message
                });
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        const stats = await db.getStats();
        
        res.json({
            success: true,
            message: 'Full sync completed',
            results,
            stats,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
        
    } catch (error) {
        console.error('Full sync error:', error);
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
        const { ethers } = require('ethers');
        if (!ethers.isAddress(address)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid wallet address'
            });
        }
        
        const normalizedAddress = address.toLowerCase();
        const { minter, networkConfig } = await initializeMinter();
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
        console.log(`Manual minting ${mintAmount} tokens to ${normalizedAddress}`);
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
            await db.addRegistrant(normalizedAddress, null, 'manual-mint');
        }
        await db.markAsMinted(normalizedAddress, txHash);
        
        res.json({
            success: true,
            message: `Successfully minted ${mintAmount} tokens`,
            address: normalizedAddress,
            amount: mintAmount,
            tx_hash: txHash,
            explorer_url: `${networkConfig.explorer}/tx/${txHash}`
        });
        
    } catch (error) {
        console.error('Manual mint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
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
        env: {
            NETWORK: process.env.NETWORK ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_AMOY: process.env.TOKEN_ADDRESS_AMOY ? 'SET' : 'NOT SET',
            TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON ? 'SET' : 'NOT SET',
            PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'NOT SET',
            MINT_AMOUNT: process.env.MINT_AMOUNT || '2 (default)',
            ADMIN_USERNAME: process.env.ADMIN_USERNAME ? 'SET' : 'NOT SET',
            ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'SET' : 'NOT SET',
            DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET'
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
