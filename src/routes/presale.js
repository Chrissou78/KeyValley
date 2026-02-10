// src/routes/presale.js
// Presale routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const db = require('../db-postgres');
const minter = require('../minter');
const { requireAdminAuth } = require('../middleware/auth');
const { getNetworkConfig } = require('../config/networks');
const { PRESALE_CONFIG, VIP_TOKEN_ADDRESS } = require('../config/constants');

// Initialize Stripe only if secret key exists
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Get presale config (public)
// GET /api/presale/config - Public presale configuration
router.get('/config', async (req, res) => {
    try {
        // Default config
        let config = {
            saleTargetEUR: 500000,
            tokenPrice: 1.00,
            minPurchase: 10,
            maxPurchase: 10000,
            presaleWallet: '',
            presaleEnabled: true,
            totalTokens: 1000000
        };

        // Load from DB
        try {
            const configResult = await db.pool.query('SELECT * FROM presale_config WHERE id = 1');
            if (configResult.rows.length > 0) {
                const c = configResult.rows[0];
                config.saleTargetEUR = parseFloat(c.sale_target_eur) || config.saleTargetEUR;
                config.tokenPrice = parseFloat(c.token_price) || config.tokenPrice;
                config.minPurchase = parseFloat(c.min_purchase) || config.minPurchase;
                config.maxPurchase = parseFloat(c.max_purchase) || config.maxPurchase;
                config.presaleWallet = c.presale_wallet || config.presaleWallet;
                config.presaleEnabled = c.presale_enabled !== false;
                config.totalTokens = parseFloat(c.total_tokens) || config.totalTokens;
            }
        } catch (dbErr) {
            console.log('Could not load presale_config:', dbErr.message);
        }

        // Get sales totals
        let eurRaised = 0;
        let tokensSold = 0;
        try {
            const result = await db.pool.query(`
                SELECT 
                    COALESCE(SUM(net_amount), 0) as eur_raised,
                    COALESCE(SUM(token_amount), 0) as tokens_sold
                FROM presale_purchases 
                WHERE status IN ('completed', 'minted')
            `);
            if (result.rows.length > 0) {
                eurRaised = parseFloat(result.rows[0].eur_raised) || 0;
                tokensSold = parseFloat(result.rows[0].tokens_sold) || 0;
            }
        } catch (dbErr) {
            console.error('Failed to get sales:', dbErr.message);
        }

        // Exchange rates with fallbacks
        let eurUsdRate = 1.19;
        let polPrice = 0.12;
        
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            const rateData = await rateRes.json();
            eurUsdRate = rateData.rates?.USD || 1.19;
        } catch (e) {}

        try {
            const polRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=polygon-ecosystem-token&vs_currencies=usd');
            const polData = await polRes.json();
            polPrice = polData['polygon-ecosystem-token']?.usd || 0.12;
        } catch (e) {}

        const progressPct = (eurRaised / config.saleTargetEUR) * 100;

        res.json({
            eurRaised,
            saleTargetEUR: config.saleTargetEUR,
            progressPct: parseFloat(progressPct.toFixed(2)),
            tokensSold,
            totalTokens: config.totalTokens,
            tokenPrice: config.tokenPrice,
            eurUsdRate,
            polPrice,
            presaleEnabled: config.presaleEnabled,
            presaleWallet: config.presaleWallet,
            minPurchase: config.minPurchase,
            maxPurchase: config.maxPurchase,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY
        });
    } catch (error) {
        console.error('Config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create Payment Intent for Stripe Elements
router.post('/create-payment-intent', async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ error: 'Card payments not available' });
    }
    
    try {
        const { walletAddress, tokenAmount, email } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!tokenAmount || tokenAmount < PRESALE_CONFIG.minPurchase || tokenAmount > PRESALE_CONFIG.maxPurchase) {
            return res.status(400).json({ 
                error: `Token amount must be between ${PRESALE_CONFIG.minPurchase} and ${PRESALE_CONFIG.maxPurchase}` 
            });
        }
        
        const normalizedAddress = walletAddress.toLowerCase();
        const baseEUR = tokenAmount * PRESALE_CONFIG.tokenPrice;
        
        const stripeFeePercent = 3;
        const platformFeePercent = 1;
        const totalFeePercent = stripeFeePercent + platformFeePercent;
        
        const feeEUR = baseEUR * (totalFeePercent / 100);
        const totalEUR = baseEUR + feeEUR;
        const amountCents = Math.round(totalEUR * 100);
        
        const platformFeeCents = Math.round(feeEUR * 100);
        const connectedAccountCents = amountCents - platformFeeCents;
        
        console.log(' Creating Payment Intent:', { 
            wallet: normalizedAddress, 
            tokens: tokenAmount, 
            total: `€${totalEUR.toFixed(2)}`
        });
        
        const paymentIntentConfig = {
            amount: amountCents,
            currency: 'eur',
            payment_method_types: ['card'],
            metadata: {
                walletAddress: normalizedAddress,
                tokenAmount: tokenAmount.toString(),
                baseAmount: baseEUR.toFixed(2),
                feeAmount: feeEUR.toFixed(2),
                feePercent: totalFeePercent.toString(),
                source: 'presale'
            },
            receipt_email: email || undefined,
            description: `${tokenAmount} VIP Tokens - Kea Valley Presale`
        };
        
        if (process.env.STRIPE_DESTINATION_ACCOUNT) {
            paymentIntentConfig.transfer_data = {
                destination: process.env.STRIPE_DESTINATION_ACCOUNT,
                amount: connectedAccountCents
            };
        }
        
        const paymentIntent = await stripe.paymentIntents.create(paymentIntentConfig);
        
        console.log(' Payment Intent created:', paymentIntent.id);
        
        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            baseAmount: baseEUR,
            feeAmount: feeEUR,
            feePercent: totalFeePercent,
            totalAmount: totalEUR,
            currency: 'EUR'
        });
        
    } catch (error) {
        console.error(' Payment Intent error:', error);
        res.status(500).json({ error: 'Failed to create payment' });
    }
});

// Get purchase status
router.get('/purchase-status/:paymentIntentId', async (req, res) => {
    try {
        const { paymentIntentId } = req.params;
        
        const result = await db.pool.query(
            `SELECT status, mint_tx_hash, token_amount, error_message 
             FROM presale_purchases 
             WHERE stripe_payment_intent = $1 OR payment_tx_hash = $1`,
            [paymentIntentId]
        );
        
        if (result.rows.length === 0) {
            return res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
        }
        
        const purchase = result.rows[0];
        res.json({
            status: purchase.status,
            mintTxHash: purchase.mint_tx_hash,
            tokenAmount: purchase.token_amount,
            error: purchase.error_message
        });
    } catch (error) {
        console.error(' Purchase status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin Manual Mint (Cash/Direct Transfers)
router.post('/admin/manual-mint', requireAdminAuth, async (req, res) => {
    console.log(' Manual mint endpoint hit');
    
    try {
        const { walletAddress, eurAmount } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!eurAmount || eurAmount <= 0) {
            return res.status(400).json({ error: 'Invalid EUR amount' });
        }
        
        const normalizedAddress = walletAddress.toLowerCase();
        const tokenPrice = PRESALE_CONFIG.tokenPrice || 1.00;
        const calculatedTokens = eurAmount / tokenPrice;
        const platformFee = eurAmount * 0.01;
        const feeCents = Math.round(platformFee * 100);
        
        console.log(` Manual mint request: ${calculatedTokens} VIP to ${normalizedAddress}`);
        
        let stripeTransferId = null;
        
        // Only process Stripe fee transfer if configured
        if (stripe && process.env.STRIPE_DESTINATION_ACCOUNT && process.env.STRIPE_ACCOUNT_ID) {
            console.log(` Checking connected account balance...`);
            
            let availableCents = 0;
            try {
                const balance = await stripe.balance.retrieve({
                    stripeAccount: process.env.STRIPE_DESTINATION_ACCOUNT
                });
                
                const eurBalance = balance.available.find(b => b.currency === 'eur');
                availableCents = eurBalance ? eurBalance.amount : 0;
                
                console.log(` Connected account EUR balance: €${(availableCents / 100).toFixed(2)}`);
            } catch (balanceError) {
                console.error(` Balance check failed:`, balanceError.message);
                return res.status(500).json({ error: 'Failed to check connected account balance' });
            }
            
            if (availableCents < feeCents) {
                console.error(` Insufficient balance: need €${platformFee.toFixed(2)}, have €${(availableCents / 100).toFixed(2)}`);
                return res.status(400).json({ 
                    error: 'Insufficient balance in connected account',
                    required: platformFee,
                    available: availableCents / 100
                });
            }
            
            console.log(` Transferring €${platformFee.toFixed(2)} from connected account to platform...`);
            
            try {
                const transfer = await stripe.transfers.create({
                    amount: feeCents,
                    currency: 'eur',
                    destination: process.env.STRIPE_ACCOUNT_ID,
                    description: `Manual mint fee - ${calculatedTokens} VIP to ${normalizedAddress.slice(0, 8)}...`,
                    metadata: {
                        type: 'manual_mint_fee',
                        walletAddress: normalizedAddress,
                        tokenAmount: calculatedTokens.toString(),
                        eurAmount: eurAmount.toString()
                    }
                }, {
                    stripeAccount: process.env.STRIPE_DESTINATION_ACCOUNT
                });
                
                stripeTransferId = transfer.id;
                console.log(` Fee transferred: ${stripeTransferId}`);
            } catch (transferError) {
                console.error(` Fee transfer failed:`, transferError.message);
                return res.status(500).json({ error: 'Fee transfer failed: ' + transferError.message });
            }
        } else {
            console.log('  Stripe not configured for fee transfer, proceeding without');
        }
        
        // Get EUR/USD rate
        let eurUsdRate = 1.19;
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            const rateData = await rateRes.json();
            eurUsdRate = rateData.rates?.USD || 1.19;
        } catch (e) {
            console.log('  Using default EUR/USD rate: 1.19');
        }
        
        const usdAmount = eurAmount * eurUsdRate;
        
        // Record purchase
        console.log(` Recording purchase in DB...`);
        const purchaseResult = await db.pool.query(`
            INSERT INTO presale_purchases 
            (wallet_address, token_amount, payment_amount, eur_amount, usd_amount, payment_method, platform_fee, status, stripe_transfer_id, created_at)
            VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'pending', $7, NOW())
            RETURNING id
        `, [normalizedAddress, calculatedTokens, eurAmount, eurAmount, usdAmount, platformFee, stripeTransferId]);
        
        const purchaseId = purchaseResult.rows[0].id;
        console.log(` Purchase recorded: ID ${purchaseId}`);
        
        // Mint tokens
        console.log(` Initializing minter...`);
        await minter.initialize();
        
        console.log(` Minting ${calculatedTokens} VIP to ${normalizedAddress}...`);
        const mintResult = await minter.mintToAddress(normalizedAddress, parseFloat(calculatedTokens), true);
        
        if (!mintResult.success && !mintResult.txHash && !mintResult.receipt) {
            console.error(` Mint failed:`, mintResult.error);
            await db.pool.query(`UPDATE presale_purchases SET status = 'mint_failed' WHERE id = $1`, [purchaseId]);
            return res.status(500).json({ 
                error: 'Minting failed', 
                details: mintResult.error,
                stripeTransferId,
                needsRefund: !!stripeTransferId
            });
        }
        
        const mintTxHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash;
        console.log(` Minted! TX: ${mintTxHash}`);
        
        // Update purchase
        await db.pool.query(`
            UPDATE presale_purchases 
            SET mint_tx_hash = $1, status = 'completed', minted_at = NOW()
            WHERE id = $2
        `, [mintTxHash, purchaseId]);
        
        // Update presale config
        try {
            await db.pool.query(`
                UPDATE presale_config 
                SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                    eur_raised = COALESCE(eur_raised, 0) + $2,
                    updated_at = NOW() 
                WHERE id = 1
            `, [parseFloat(calculatedTokens), eurAmount]);
            console.log(`  PRESALE CONFIG UPDATED: +${calculatedTokens} tokens sold`);
        } catch (configError) {
            console.error('  Failed to update presale_config:', configError.message);
        }
        
        // Process referral bonus
        let referralBonusTx = null;
        let referralBonusAmount = 0;
        
        try {
            const referralResult = await db.pool.query(`
                SELECT r.referrer_wallet, r.referrer_code, rc.owner_wallet
                FROM referrals r
                LEFT JOIN referral_codes rc ON r.referrer_code = rc.code
                WHERE r.referred_wallet = $1
            `, [normalizedAddress]);
            
            if (referralResult.rows.length > 0) {
                const row = referralResult.rows[0];
                const referrerWallet = row.referrer_wallet || row.owner_wallet;
                const referrerCode = row.referrer_code;
                
                if (referrerWallet) {
                    const settingsResult = await db.pool.query(`
                        SELECT * FROM referral_settings WHERE id = 1
                    `);
                    
                    const settings = settingsResult.rows[0] || {};
                    const minPurchase = parseFloat(settings.min_purchase_for_bonus) || 0;
                    
                    if (settings.enabled && eurAmount >= minPurchase) {
                        const bonusType = settings.presale_bonus_type || 'percentage';
                        const bonusValue = parseFloat(settings.presale_bonus_amount) || 5;
                        
                        referralBonusAmount = bonusType === 'percentage'
                            ? (calculatedTokens * bonusValue) / 100
                            : bonusValue;
                        
                        if (referralBonusAmount > 0) {
                            console.log(` Minting referral bonus to ${referrerWallet}...`);
                            
                            const bonusMintResult = await minter.mintToAddress(
                                referrerWallet.toLowerCase(), 
                                referralBonusAmount, 
                                true
                            );
                            
                            if (bonusMintResult.success || bonusMintResult.txHash || bonusMintResult.receipt) {
                                referralBonusTx = bonusMintResult.txHash || bonusMintResult.receipt?.hash;
                                console.log(` Referral bonus TX: ${referralBonusTx}`);
                                
                                await db.pool.query(`
                                    UPDATE referrals 
                                    SET presale_bonus_paid = COALESCE(presale_bonus_paid, 0) + $1
                                    WHERE referred_wallet = $2
                                `, [referralBonusAmount, normalizedAddress]);
                                
                                await db.pool.query(`
                                    UPDATE referral_codes 
                                    SET total_bonus_earned = COALESCE(total_bonus_earned, 0) + $1,
                                        total_presale_purchases = COALESCE(total_presale_purchases, 0) + 1,
                                        updated_at = NOW()
                                    WHERE code = $2
                                `, [referralBonusAmount, referrerCode]);
                            }
                        }
                    }
                }
            }
        } catch (refError) {
            console.error('  Referral error (non-fatal):', refError.message);
        }
        
        console.log(` Manual mint complete!`);
        
        const networkConfig = getNetworkConfig();
        return res.json({
            success: true,
            purchaseId,
            txHash: mintTxHash,
            tokenAmount: calculatedTokens,
            eurAmount,
            platformFee,
            stripeTransferId,
            explorer_url: `${networkConfig.explorer}/tx/${mintTxHash}`,
            referralBonus: referralBonusAmount > 0 ? {
                amount: referralBonusAmount,
                txHash: referralBonusTx
            } : null
        });
        
    } catch (error) {
        console.error(' Manual mint error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// Get manual mints list
router.get('/admin/manual-mints', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, wallet_address, token_amount, eur_amount, usd_amount, 
                   mint_tx_hash, status, created_at
            FROM presale_purchases 
            WHERE payment_method = 'manual' AND status IN ('completed', 'minted')
            ORDER BY created_at DESC
            LIMIT 50
        `);
        
        res.json({ mints: result.rows });
        
    } catch (error) {
        console.error('Load manual mints error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Fee summary for cash payments
router.get('/admin/fee-summary', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                COUNT(*) as total_cash_purchases,
                COALESCE(SUM(token_amount), 0) as total_tokens,
                COALESCE(SUM(eur_amount), 0) as total_eur,
                COALESCE(SUM(platform_fee), 0) as total_fees_owed,
                COALESCE(SUM(CASE WHEN stripe_fee > 0 THEN platform_fee ELSE 0 END), 0) as total_fees_settled
            FROM presale_purchases
            WHERE payment_method IN ('cash', 'bank_transfer', 'manual')
            AND status = 'completed'
        `);
        
        const summary = result.rows[0];
        
        res.json({
            success: true,
            summary: {
                totalCashPurchases: parseInt(summary.total_cash_purchases),
                totalTokens: parseFloat(summary.total_tokens),
                totalEur: parseFloat(summary.total_eur),
                totalFeesOwed: parseFloat(summary.total_fees_owed),
                totalFeesSettled: parseFloat(summary.total_fees_settled),
                feesOutstanding: parseFloat(summary.total_fees_owed) - parseFloat(summary.total_fees_settled)
            }
        });
    } catch (error) {
        console.error(' Fee summary error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fulfill all pending orders
router.post('/admin/fulfill-all', requireAdminAuth, async (req, res) => {
    try {
        const pending = await db.pool.query(
            `SELECT id, wallet_address, token_amount, purchase_bonus_tokens 
             FROM presale_purchases 
             WHERE status IN ('paid', 'pending_mint') 
             ORDER BY created_at ASC 
             LIMIT 50`
        );

        if (pending.rows.length === 0) {
            return res.json({ success: true, message: 'No pending orders to fulfill', fulfilled: 0 });
        }

        await minter.initialize();

        let fulfilled = 0;
        let failed = 0;
        const results = [];

        for (const p of pending.rows) {
            try {
                const totalTokens = parseFloat(p.token_amount) + (parseFloat(p.purchase_bonus_tokens) || 0);
                const mintResult = await minter.mintToAddress(p.wallet_address, totalTokens, true);

                if (mintResult.success) {
                    const mintTxHash = mintResult.txHash || mintResult.receipt?.hash;
                    await db.pool.query(
                        `UPDATE presale_purchases 
                         SET status = 'completed', mint_tx_hash = $1, minted_at = NOW(), updated_at = NOW() 
                         WHERE id = $2`,
                        [mintTxHash, p.id]
                    );
                    await db.pool.query(
                        `UPDATE presale_config SET tokens_sold = tokens_sold + $1, updated_at = NOW() WHERE id = 1`,
                        [totalTokens]
                    );
                    fulfilled++;
                    results.push({ id: p.id, success: true, txHash: mintTxHash });
                } else {
                    failed++;
                    results.push({ id: p.id, success: false, error: mintResult.error });
                }
            } catch (e) {
                failed++;
                results.push({ id: p.id, success: false, error: e.message });
            }
        }

        res.json({ success: true, fulfilled, failed, total: pending.rows.length, results });

    } catch (error) {
        console.error('Batch fulfill error:', error);
        res.status(500).json({ error: 'Failed to fulfill orders' });
    }
});

module.exports = router;
