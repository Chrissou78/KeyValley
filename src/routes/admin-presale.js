// src/routes/admin-presale.js
// Admin presale routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const db = require('../db-postgres');
const minter = require('../minter');
const { requireAdminAuth } = require('../middleware/auth');
const { getNetworkConfig } = require('../config/networks');
const { PRESALE_CONFIG } = require('../config/constants');

// Get presale settings
router.get('/settings', requireAdminAuth, async (req, res) => {
    try {
        const configResult = await db.pool.query('SELECT * FROM presale_config WHERE id = 1');
        
        if (configResult.rows.length === 0) {
            return res.json({
                success: true,
                settings: {
                    saleTargetEUR: 500000,
                    tokenPrice: 1.00,
                    minPurchase: 10,
                    maxPurchase: 10000,
                    presaleWallet: PRESALE_CONFIG.presaleWallet || '',
                    presaleEnabled: false
                }
            });
        }
        
        const c = configResult.rows[0];
        res.json({
            success: true,
            settings: {
                saleTargetEUR: parseFloat(c.sale_target_eur) || 500000,
                tokenPrice: parseFloat(c.token_price) || 1.00,
                minPurchase: parseFloat(c.min_purchase) || 10,
                maxPurchase: parseFloat(c.max_purchase) || 10000,
                presaleWallet: c.presale_wallet || PRESALE_CONFIG.presaleWallet || '',
                presaleEnabled: c.presale_enabled !== false,
                tokensSold: parseFloat(c.tokens_sold) || 0,
                eurRaised: parseFloat(c.eur_raised) || 0
            }
        });
    } catch (error) {
        console.error('Error fetching presale settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update presale settings
router.post('/settings', requireAdminAuth, async (req, res) => {
    try {
        const { saleTargetEUR, tokenPrice, minPurchase, presaleWallet, presaleEnabled } = req.body;
        
        PRESALE_CONFIG.saleTargetEUR = saleTargetEUR || 500000;
        PRESALE_CONFIG.tokenPrice = tokenPrice || 1.00;
        PRESALE_CONFIG.minPurchase = minPurchase || 10;
        PRESALE_CONFIG.presaleWallet = presaleWallet || PRESALE_CONFIG.presaleWallet;
        PRESALE_CONFIG.presaleEnabled = presaleEnabled !== false;
        
        await db.pool.query(`
            INSERT INTO presale_config (id, sale_target_eur, token_price, min_purchase, presale_wallet, presale_enabled, updated_at)
            VALUES (1, $1, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
                sale_target_eur = $1, token_price = $2, min_purchase = $3,
                presale_wallet = $4, presale_enabled = $5, updated_at = NOW()
        `, [saleTargetEUR, tokenPrice, minPurchase, presaleWallet, presaleEnabled]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get presale stats
router.get('/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status IN ('completed', 'minted', 'paid', 'pending_mint')) as total_purchases,
                COALESCE(SUM(token_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as tokens_sold,
                COALESCE(SUM(net_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as eur_raised,
                COALESCE(SUM(eur_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as eur_gross,
                COALESCE(SUM(platform_fee) FILTER (WHERE status IN ('completed', 'minted')), 0) as total_fees,
                COUNT(DISTINCT wallet_address) FILTER (WHERE status IN ('completed', 'minted', 'paid', 'pending_mint')) as unique_buyers,
                COUNT(*) FILTER (WHERE status = 'pending_mint') as pending_mint,
                COUNT(*) FILTER (WHERE status = 'paid') as paid,
                COUNT(*) FILTER (WHERE status IN ('completed', 'minted')) as minted
            FROM presale_purchases
        `);
        
        const row = stats.rows[0];
        const eurRaised = parseFloat(row.eur_raised) || 0;
        const saleTargetEUR = PRESALE_CONFIG.saleTargetEUR || 500000;
        
        res.json({
            eurRaised,
            eurGross: parseFloat(row.eur_gross) || 0,
            totalFees: parseFloat(row.total_fees) || 0,
            saleTargetEUR,
            progressPct: parseFloat(((eurRaised / saleTargetEUR) * 100).toFixed(2)),
            tokensSold: parseFloat(row.tokens_sold) || 0,
            totalTokens: PRESALE_CONFIG.totalTokens || 1000000,
            tokenPriceEUR: PRESALE_CONFIG.tokenPrice || 1.00,
            totalPurchases: parseInt(row.total_purchases) || 0,
            uniqueBuyers: parseInt(row.unique_buyers) || 0,
            pendingMint: parseInt(row.pending_mint) || 0,
            paid: parseInt(row.paid) || 0,
            minted: parseInt(row.minted) || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all purchases
router.get('/purchases', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, wallet_address, token_amount, eur_amount, usd_amount,
                platform_fee, net_amount, payment_method, stripe_payment_intent,
                payment_tx_hash, status, mint_tx_hash, referrer_bonus,
                referral_bonus_amount, referral_bonus_paid, error_message,
                created_at, minted_at
            FROM presale_purchases
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json({ purchases: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get bonus tiers (admin)
router.get('/bonus-tiers', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, min_eur, bonus_percent, is_active
            FROM presale_bonus_tiers
            ORDER BY min_eur ASC
        `);
        
        res.json({ tiers: result.rows });
    } catch (error) {
        console.error('Failed to fetch bonus tiers:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save bonus tiers (admin)
router.post('/bonus-tiers', requireAdminAuth, async (req, res) => {
    const { tiers } = req.body;
    
    if (!Array.isArray(tiers)) {
        return res.status(400).json({ error: 'Tiers must be an array' });
    }
    
    console.log('💰 Saving bonus tiers:', tiers);
    
    try {
        await db.pool.query('BEGIN');
        
        await db.pool.query('UPDATE presale_bonus_tiers SET is_active = false');
        
        for (const tier of tiers) {
            const minEur = parseFloat(tier.min_eur) || 0;
            const bonusPercent = parseFloat(tier.bonus_percent) || 0;
            
            if (minEur > 0 && bonusPercent > 0) {
                const existing = await db.pool.query(
                    'SELECT id FROM presale_bonus_tiers WHERE min_eur = $1',
                    [minEur]
                );
                
                if (existing.rows.length > 0) {
                    await db.pool.query(`
                        UPDATE presale_bonus_tiers 
                        SET bonus_percent = $1, is_active = true, updated_at = NOW()
                        WHERE min_eur = $2
                    `, [bonusPercent, minEur]);
                } else {
                    await db.pool.query(`
                        INSERT INTO presale_bonus_tiers (min_eur, bonus_percent, is_active, created_at, updated_at)
                        VALUES ($1, $2, true, NOW(), NOW())
                    `, [minEur, bonusPercent]);
                }
            }
        }
        
        await db.pool.query('DELETE FROM presale_bonus_tiers WHERE is_active = false');
        await db.pool.query('COMMIT');
        
        console.log('✅ Bonus tiers saved successfully');
        res.json({ success: true });
        
    } catch (error) {
        await db.pool.query('ROLLBACK');
        console.error('❌ Failed to save bonus tiers:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manual mint for specific purchase
router.post('/mint/:purchaseId', requireAdminAuth, async (req, res) => {
    try {
        const { purchaseId } = req.params;
        
        const purchaseResult = await db.pool.query(
            'SELECT * FROM presale_purchases WHERE id = $1',
            [purchaseId]
        );
        
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Purchase not found' });
        }
        
        const purchase = purchaseResult.rows[0];
        
        if (purchase.status === 'completed' || purchase.status === 'minted') {
            return res.status(400).json({ success: false, error: 'Already minted' });
        }
        
        // Calculate total tokens including bonus
        const baseTokens = parseFloat(purchase.token_amount) || 0;
        const bonusTokens = parseFloat(purchase.purchase_bonus_tokens) || 0;
        const totalTokens = baseTokens + bonusTokens;
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const mintResult = await minter.mintToAddress(purchase.wallet_address, totalTokens, true);
        
        if (mintResult && (mintResult.success || mintResult.txHash || mintResult.receipt)) {
            const txHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash;
            
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', mint_tx_hash = $1, minted_at = NOW()
                WHERE id = $2
            `, [txHash, purchaseId]);
            
            // Update presale config
            try {
                await db.pool.query(`
                    UPDATE presale_config 
                    SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                        updated_at = NOW() 
                    WHERE id = 1
                `, [totalTokens]);
            } catch (e) {}
            
            return res.json({
                success: true,
                txHash,
                tokenAmount: totalTokens,
                explorer_url: `${networkConfig.explorer}/tx/${txHash}`
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: mintResult?.error || 'Minting failed' 
            });
        }
        
    } catch (error) {
        console.error('❌ Manual mint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
