// src/routes/index.js
// Central route aggregator - wires all routes together

const express = require('express');
const router = express.Router();

// Import all route modules
const staticRoutes = require('./static');
const walletRoutes = require('./wallet');
const claimRoutes = require('./claim');
const questionnaireRoutes = require('./questionnaire');
const transactionsRoutes = require('./transactions');
const referralRoutes = require('./referral');
const presaleRoutes = require('./presale');
const adminRoutes = require('./admin');
const adminReferralRoutes = require('./admin-referral');
const adminPresaleRoutes = require('./admin-presale');
const stripeRoutes = require('./stripe');
const walletTwoRoutes = require('./wallettwo');
const healthRoutes = require('./health');

// Mount routes

// Static pages (must be first for HTML routes)
router.use('/', staticRoutes);

// Health check
router.use('/api/health', healthRoutes);

// Wallet routes
router.use('/api/wallet', walletRoutes);

// Claim routes
router.use('/api/claim', claimRoutes);

// Questionnaire routes
router.use('/api/questionnaire', questionnaireRoutes);

// Transaction management (admin)
router.use('/api/admin', transactionsRoutes);

// Referral routes (public)
router.use('/api/referral', referralRoutes);

// Admin referral routes
router.use('/api/admin/referral', adminReferralRoutes);

// Presale routes (public)
router.use('/api/presale', presaleRoutes);

// Admin presale routes
router.use('/api/admin/presale', adminPresaleRoutes);

// Admin routes (registrants, minting, settings)
router.use('/api/admin', adminRoutes);

// Stripe webhook (needs raw body - handled in server.js)
router.use('/api/stripe', stripeRoutes);

// WalletTwo integration
router.use('/api/wallettwo', walletTwoRoutes);

// Users endpoint
router.post('/api/users/create', async (req, res) => {
    const db = require('../db-postgres');
    try {
        const { wallet_address } = req.body;
        
        if (!wallet_address) {
            return res.status(400).json({ success: false, error: 'Wallet address required' });
        }

        const exists = await db.pool.query(
            'SELECT id FROM registrants WHERE wallet_address = $1',
            [wallet_address.toLowerCase()]
        );

        if (exists.rows.length > 0) {
            return res.json({ success: true, message: 'User already exists' });
        }

        res.json({ success: true, message: 'Ready for registration' });

    } catch (error) {
        console.error('Error checking user:', error);
        res.status(500).json({ success: false, error: 'Failed to check user' });
    }
});

// Get user data by wallet
router.get('/api/user/:wallet', async (req, res) => {
    const db = require('../db-postgres');
    try {
        const wallet = req.params.wallet.toLowerCase();
        
        const result = await db.pool.query(
            'SELECT wallet_address, email, source, created_at FROM registrants WHERE wallet_address = $1',
            [wallet]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Members sync
router.get('/api/members/sync', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    
    try {
        if (!process.env.WALLETTWO_API_KEY || !process.env.WALLETTWO_COMPANY_ID) {
            return res.status(503).json({ error: 'WalletTwo not configured' });
        }

        const baseUrl = `https://api.wallettwo.com/company/api/company/${process.env.WALLETTWO_COMPANY_ID}/members`;
        const headers = {
            'Authorization': `Bearer ${process.env.WALLETTWO_API_KEY}`,
            'Content-Type': 'application/json'
        };

        let allMembers = [];
        let currentPage = 1;
        let totalPages = 1;

        console.log(`Fetching WalletTwo members page ${currentPage}...`);
        const firstResponse = await fetch(`${baseUrl}?page=${currentPage}`, { headers });
        
        if (!firstResponse.ok) {
            throw new Error(`WalletTwo API error: ${firstResponse.status}`);
        }

        const firstData = await firstResponse.json();
        totalPages = firstData.totalPages || firstData.total_pages || 1;
        const firstPageMembers = firstData.members || firstData.data || firstData.users || [];
        allMembers = allMembers.concat(firstPageMembers);

        for (currentPage = 2; currentPage <= totalPages; currentPage++) {
            const response = await fetch(`${baseUrl}?page=${currentPage}`, { headers });
            if (!response.ok) continue;
            const data = await response.json();
            const pageMembers = data.members || data.data || data.users || [];
            allMembers = allMembers.concat(pageMembers);
            await new Promise(r => setTimeout(r, 100));
        }

        let synced = 0, updated = 0, errors = 0;

        for (const member of allMembers) {
            const walletAddress = member.wallet_address || member.walletAddress || member.wallet;
            if (!walletAddress) continue;

            try {
                const normalizedWallet = walletAddress.toLowerCase();
                const existing = await db.pool.query(
                    'SELECT id FROM registrants WHERE wallet_address = $1',
                    [normalizedWallet]
                );

                const email = member.email || null;
                const name = member.name || member.fullName || member.full_name || null;

                if (existing.rows.length > 0) {
                    await db.pool.query(
                        `UPDATE registrants 
                         SET email = COALESCE($1, email), 
                             name = COALESCE($2, name), 
                             source = $3, 
                             updated_at = NOW() 
                         WHERE wallet_address = $4`,
                        [email, name, 'wallettwo_sync', normalizedWallet]
                    );
                    updated++;
                } else {
                    await db.pool.query(
                        `INSERT INTO registrants (wallet_address, email, name, source, created_at) 
                         VALUES ($1, $2, $3, $4, NOW())`,
                        [normalizedWallet, email, name, 'wallettwo_sync']
                    );
                    synced++;
                }
            } catch (e) {
                errors++;
            }
        }

        res.json({ success: true, totalPages, totalFetched: allMembers.length, synced, updated, errors });

    } catch (error) {
        res.status(500).json({ error: 'Failed to sync members: ' + error.message });
    }
});

// Claim settings endpoints
router.get('/api/admin/claim/settings', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    try {
        const result = await db.pool.query(
            "SELECT value FROM app_settings WHERE key = 'mint_amount'"
        );
        const mintAmount = result.rows.length > 0 
            ? parseInt(result.rows[0].value)
            : parseInt(process.env.MINT_AMOUNT) || 2;
        res.json({ mintAmount });
    } catch (error) {
        res.json({ mintAmount: parseInt(process.env.MINT_AMOUNT) || 2 });
    }
});

router.post('/api/admin/claim/settings', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    try {
        const { mintAmount } = req.body;
        if (!mintAmount || mintAmount < 1 || mintAmount > 100) {
            return res.status(400).json({ success: false, error: 'Invalid mint amount (1-100)' });
        }
        await db.pool.query(`
            INSERT INTO app_settings (key, value, updated_at) 
            VALUES ('mint_amount', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [mintAmount.toString()]);
        res.json({ success: true, mintAmount });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to save settings' });
    }
});

// Public bonus tiers endpoint
router.get('/api/presale/bonus-tiers', async (req, res) => {
    const db = require('../db-postgres');
    try {
        const result = await db.pool.query(`
            SELECT min_eur, bonus_percent
            FROM presale_bonus_tiers
            WHERE is_active = true
            ORDER BY min_eur ASC
        `);
        res.json({ tiers: result.rows });
    } catch (error) {
        res.json({ tiers: [] });
    }
});

// Presale packages
router.get('/api/presale/packages', async (req, res) => {
    const db = require('../db-postgres');
    try {
        const holidayResult = await db.pool.query(
            "SELECT COUNT(*) as count FROM presale_purchases WHERE purchase_type = 'package_holiday' AND status = 'completed'"
        );
        const membershipResult = await db.pool.query(
            "SELECT COUNT(*) as count FROM presale_purchases WHERE purchase_type = 'package_membership' AND status = 'completed'"
        );
        
        const holidaySold = parseInt(holidayResult.rows[0]?.count || 0);
        const membershipSold = parseInt(membershipResult.rows[0]?.count || 0);
        
        res.json({
            holiday: {
                name: '2026 Holiday Pack',
                price: 5000,
                tokens: 10000,
                totalAvailable: 30,
                sold: holidaySold,
                remaining: Math.max(0, 30 - holidaySold)
            },
            membership: {
                name: 'Private Members Club',
                price: 25000,
                tokens: 50000,
                totalAvailable: null,
                sold: membershipSold,
                remaining: null
            }
        });
    } catch (error) {
        res.json({
            holiday: { totalAvailable: 30, sold: 0, remaining: 30 },
            membership: { totalAvailable: null, sold: 0, remaining: null }
        });
    }
});

// Get all registrants (admin)
router.get('/api/registrants', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    try {
        const result = await db.pool.query(`
            SELECT 
                id, wallet_address, email, minted, tx_hash, tx_status,
                minted_at, registered_at, referrer_wallet, referrer_code,
                claim_amount, claimed, registration_complete, source
            FROM registrants 
            ORDER BY registered_at DESC
            LIMIT 1000
        `);
        res.json({ success: true, registrants: result.rows });
    } catch (error) {
        console.error('Error fetching registrants:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats (admin)
router.get('/api/stats', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    try {
        const total = await db.pool.query('SELECT COUNT(*) FROM registrants');
        const minted = await db.pool.query('SELECT COUNT(*) FROM registrants WHERE minted = true');
        const pending = await db.pool.query('SELECT COUNT(*) FROM registrants WHERE minted = false OR minted IS NULL');
        const withBalance = await db.pool.query("SELECT COUNT(*) FROM registrants WHERE tx_status = 'confirmed'");
        
        res.json({
            success: true,
            stats: {
                total: parseInt(total.rows[0].count),
                minted: parseInt(minted.rows[0].count),
                pending: parseInt(pending.rows[0].count),
                withBalance: parseInt(withBalance.rows[0].count)
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Full sync - check on-chain balances and sync TX hashes from Polygonscan
router.post('/api/full-sync', require('../middleware/auth').requireAdminAuth, async (req, res) => {
    const db = require('../db-postgres');
    const minter = require('../minter');
    
    try {
        await minter.initialize();
        
        const VIP_TOKEN_ADDRESS = process.env.VIP_TOKEN_ADDRESS || '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
        const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';
        const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
        const minterAddress = minter.wallet?.address || process.env.MINTER_ADDRESS || '';
        
        // Get all registrants
        const registrantsResult = await db.pool.query(`
            SELECT wallet_address, email, minted, tx_hash, tx_status, registered_at 
            FROM registrants
        `);
        const registrants = registrantsResult.rows;
        
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
                const balance = await minter.getBalance(registrant.wallet_address);
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
                
                // If has balance but no valid tx hash, look it up on Polygonscan
                if (hasBalance && !hasValidTxHash) {
                    try {
                        const apiUrl = `${POLYGONSCAN_API}?module=account&action=tokentx` +
                            `&contractaddress=${VIP_TOKEN_ADDRESS}` +
                            `&address=${registrant.wallet_address}` +
                            `&page=1&offset=100&sort=desc` +
                            (POLYGONSCAN_API_KEY ? `&apikey=${POLYGONSCAN_API_KEY}` : '');
                        
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        if (data.status === '1' && data.result && data.result.length > 0) {
                            let mintTx = null;
                            
                            if (minterAddress) {
                                mintTx = data.result.find(tx => 
                                    tx.from.toLowerCase() === minterAddress.toLowerCase() &&
                                    tx.to.toLowerCase() === registrant.wallet_address.toLowerCase()
                                );
                            }
                            
                            if (!mintTx) {
                                mintTx = data.result.find(tx => 
                                    tx.to.toLowerCase() === registrant.wallet_address.toLowerCase()
                                );
                            }
                            
                            if (mintTx && mintTx.hash) {
                                txHash = mintTx.hash;
                                results.txHashesFound++;
                                needsUpdate = true;
                            }
                        }
                    } catch (apiError) {
                        console.error(`Polygonscan API error for ${registrant.wallet_address}:`, apiError.message);
                    }
                    
                    // Rate limit Polygonscan API
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                
                // Update database if needed
                if (hasBalance && !registrant.minted) {
                    await db.pool.query(`
                        UPDATE registrants 
                        SET minted = true, tx_hash = $2, tx_status = 'confirmed', minted_at = NOW(), updated_at = NOW()
                        WHERE wallet_address = $1
                    `, [registrant.wallet_address, txHash || 'synced-from-chain']);
                    results.updated++;
                } else if (needsUpdate && txHash) {
                    await db.pool.query(`
                        UPDATE registrants 
                        SET tx_hash = $2, tx_status = 'confirmed', updated_at = NOW()
                        WHERE wallet_address = $1
                    `, [registrant.wallet_address, txHash]);
                    results.updated++;
                }
                
                results.registrants.push({
                    address: registrant.wallet_address,
                    email: registrant.email,
                    balance: balance,
                    minted: hasBalance || registrant.minted,
                    txHash: txHash || registrant.tx_hash,
                    registeredAt: registrant.registered_at
                });
                
            } catch (regError) {
                console.error(`Error processing ${registrant.wallet_address}:`, regError.message);
                results.registrants.push({
                    address: registrant.wallet_address,
                    email: registrant.email,
                    balance: 'error',
                    minted: registrant.minted,
                    txHash: registrant.tx_hash,
                    registeredAt: registrant.registered_at,
                    error: regError.message
                });
            }
        }
        
        // Get updated stats
        const statsResult = await db.pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE minted = true) as minted,
                COUNT(*) FILTER (WHERE minted = false OR minted IS NULL) as pending,
                COUNT(*) FILTER (WHERE tx_status = 'confirmed') as confirmed
            FROM registrants
        `);
        const stats = statsResult.rows[0];
        
        console.log(`✅ Full sync completed: ${results.updated} updated, ${results.txHashesFound} TX hashes found`);
        
        res.json({
            success: true,
            message: `Full sync completed. Updated ${results.updated} records.`,
            results,
            stats: {
                total: parseInt(stats.total),
                minted: parseInt(stats.minted),
                pending: parseInt(stats.pending),
                withBalance: results.withBalance
            },
            network: 'Polygon',
            explorer: 'https://polygonscan.com'
        });
        
    } catch (error) {
        console.error('❌ Full sync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;