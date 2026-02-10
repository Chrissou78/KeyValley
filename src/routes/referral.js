// src/routes/referral.js
// Referral routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { ethers } = require('ethers');
const db = require('../db-postgres');
const minter = require('../minter');
const { requireAdminAuth } = require('../middleware/auth');

// Helper function to get referral settings
async function getReferralSettings() {
    try {
        const result = await db.pool.query('SELECT * FROM referral_settings WHERE id = 1');
        if (result.rows.length === 0) {
            return {
                enabled: false,
                bonusType: 'fixed',
                bonusAmount: 5,
                presaleBonusType: 'percentage',
                presaleBonusAmount: 5,
                minPurchaseForBonus: 10
            };
        }
        const settings = result.rows[0];
        return {
            enabled: settings.enabled,
            bonusType: settings.bonus_type,
            bonusAmount: parseFloat(settings.bonus_amount) || 0,
            presaleBonusType: settings.presale_bonus_type,
            presaleBonusAmount: parseFloat(settings.presale_bonus_amount) || 0,
            minPurchaseForBonus: parseFloat(settings.min_purchase_for_bonus) || 10
        };
    } catch (error) {
        console.error('Error getting referral settings:', error);
        return { enabled: false };
    }
}

// Helper function to generate referral code
function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Get referral code info for wallet
router.get('/code/:wallet', async (req, res) => {
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

// Validate referral code
router.get('/validate/:code', async (req, res) => {
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

// Track referral
router.post('/track', async (req, res) => {
    try {
        const { referralCode, referredWallet, referredEmail, source, purchaseAmount } = req.body;
        
        if (!referralCode || !referredWallet) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const settings = await getReferralSettings();
        
        if (!settings.enabled) {
            return res.json({ success: false, error: 'Referral program disabled' });
        }
        
        const codeResult = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1) AND enabled = true',
            [referralCode]
        );
        
        if (codeResult.rows.length === 0) {
            return res.json({ success: false, error: 'Invalid referral code' });
        }
        
        const referrerWallet = codeResult.rows[0].owner_wallet;
        
        if (referredWallet.toLowerCase() === referrerWallet.toLowerCase()) {
            return res.json({ success: false, error: 'Cannot use own referral code' });
        }
        
        const existingReferral = await db.pool.query(
            'SELECT id FROM referral_tracking WHERE LOWER(referred_wallet) = $1 AND source = $2',
            [referredWallet.toLowerCase(), source]
        );
        
        if (existingReferral.rows.length > 0) {
            return res.json({ success: false, error: 'Wallet already referred for this action' });
        }
        
        let bonusType, bonusAmount;
        if (source === 'claim') {
            bonusType = settings.bonusType;
            bonusAmount = settings.bonusAmount;
        } else if (source === 'presale') {
            bonusType = settings.presaleBonusType;
            if (bonusType === 'percentage' && purchaseAmount) {
                bonusAmount = (purchaseAmount * settings.presaleBonusAmount) / 100;
            } else {
                bonusAmount = settings.presaleBonusAmount;
            }
        }
        
        await db.pool.query(
            `INSERT INTO referral_tracking 
             (referral_code, referred_wallet, referred_email, referrer_wallet, source, bonus_type, bonus_amount, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [referralCode.toUpperCase(), referredWallet.toLowerCase(), referredEmail, referrerWallet, source, bonusType, bonusAmount]
        );
        
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

// Get referral settings (public)
router.get('/settings', async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM referral_settings WHERE id = 1');
        
        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                bonusType: 'fixed',
                bonusAmount: 5,
                presaleBonusType: 'percentage',
                presaleBonusAmount: 5,
                minPurchaseForBonus: 10
            });
        }
        
        const settings = result.rows[0];
        res.json({
            enabled: settings.enabled,
            bonusType: settings.bonus_type,
            bonusAmount: parseFloat(settings.bonus_amount) || 0,
            presaleBonusType: settings.presale_bonus_type,
            presaleBonusAmount: parseFloat(settings.presale_bonus_amount) || 0,
            minPurchaseForBonus: parseFloat(settings.min_purchase_for_bonus) || 10
        });
    } catch (error) {
        console.error('Error fetching referral settings:', error);
        res.status(500).json({ error: 'Failed to fetch referral settings' });
    }
});

// Update referral settings (admin)
router.post('/settings', requireAdminAuth, async (req, res) => {
    try {
        const { enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus } = req.body;
        
        console.log(' Saving referral settings:', { enabled, bonusType, bonusAmount });
        
        const result = await db.pool.query(`
            UPDATE referral_settings 
            SET enabled = $1, 
                bonus_type = $2, 
                bonus_amount = $3, 
                presale_bonus_type = $4, 
                presale_bonus_amount = $5,
                min_purchase_for_bonus = $6, 
                updated_at = NOW()
            WHERE id = 1
            RETURNING *
        `, [enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus]);
        
        if (result.rows.length === 0) {
            await db.pool.query(`
                INSERT INTO referral_settings (id, enabled, bonus_type, bonus_amount, presale_bonus_type, presale_bonus_amount, min_purchase_for_bonus, updated_at)
                VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
            `, [enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus]);
        }
        
        console.log(' Referral settings saved');
        res.json({ success: true, message: 'Referral settings updated' });
    } catch (error) {
        console.error(' Error updating referral settings:', error);
        res.status(500).json({ error: 'Failed to update referral settings', details: error.message });
    }
});

// Get referral status for wallet
router.get('/status/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet || !ethers.isAddress(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        const normalizedAddress = wallet.toLowerCase();

        const settingsResult = await db.pool.query(
            'SELECT * FROM referral_settings WHERE id = 1'
        );
        
        const settings = settingsResult.rows[0] || { enabled: false };
        const programEnabled = settings.enabled === true;

        const registrantResult = await db.pool.query(
            'SELECT referrer_wallet, referrer_code, referrer_set_at FROM registrants WHERE wallet_address = $1',
            [normalizedAddress]
        );
        
        const registrant = registrantResult.rows[0];
        const hasReferrer = !!(registrant?.referrer_wallet);

        const codeResult = await db.pool.query(
            'SELECT code, enabled, created_at, total_referrals, total_bonus_earned FROM referral_codes WHERE owner_wallet = $1',
            [normalizedAddress]
        );
        
        const myCodeData = codeResult.rows[0];

        res.json({
            hasReferrer,
            referrerWallet: registrant?.referrer_wallet || null,
            referrerCode: registrant?.referrer_code || null,
            referrerSetAt: registrant?.referrer_set_at || null,
            myCode: myCodeData?.code || null,
            myCodeEnabled: myCodeData?.enabled ?? null,
            myCodeCreatedAt: myCodeData?.created_at || null,
            stats: {
                totalReferrals: myCodeData?.total_referrals || 0,
                totalBonusEarned: parseFloat(myCodeData?.total_bonus_earned) || 0
            },
            programEnabled,
            bonusInfo: {
                signupType: settings.bonus_type || 'fixed',
                signupAmount: parseFloat(settings.bonus_amount) || 0,
                presaleType: settings.presale_bonus_type || 'percentage',
                presaleAmount: parseFloat(settings.presale_bonus_amount) || 0
            }
        });

    } catch (error) {
        console.error(' Referral status error:', error.message);
        res.status(500).json({ error: 'Failed to get referral status' });
    }
});

// Set referrer for user (one-time)
router.post('/set', async (req, res) => {
    try {
        const { walletAddress, referralCode } = req.body;
        
        console.log('\n🔗 SET REFERRER:', { walletAddress, referralCode });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        if (!referralCode || referralCode.length < 6) {
            return res.status(400).json({ success: false, error: 'Invalid referral code' });
        }

        const normalizedAddress = walletAddress.toLowerCase();
        const code = referralCode.toUpperCase();

        const settingsResult = await db.pool.query(
            'SELECT * FROM referral_settings WHERE id = 1'
        );
        
        if (!settingsResult.rows[0]?.enabled) {
            return res.status(400).json({ success: false, error: 'Referral program is currently disabled' });
        }

        const settings = settingsResult.rows[0];

        const existingReferrer = await db.pool.query(
            'SELECT referrer_wallet FROM registrants WHERE wallet_address = $1 AND referrer_wallet IS NOT NULL',
            [normalizedAddress]
        );

        if (existingReferrer.rows.length > 0 && existingReferrer.rows[0].referrer_wallet) {
            return res.status(400).json({ success: false, error: 'You already have a referrer set. This cannot be changed.' });
        }

        const codeResult = await db.pool.query(
            'SELECT owner_wallet, enabled FROM referral_codes WHERE code = $1',
            [code]
        );

        if (codeResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid referral code' });
        }

        const referrerWallet = codeResult.rows[0].owner_wallet;

        if (!codeResult.rows[0].enabled) {
            return res.status(400).json({ success: false, error: 'This referral code is no longer active' });
        }

        if (referrerWallet.toLowerCase() === normalizedAddress) {
            return res.status(400).json({ success: false, error: 'You cannot use your own referral code' });
        }

        const registrantResult = await db.pool.query(
            'SELECT minted, claim_amount FROM registrants WHERE wallet_address = $1',
            [normalizedAddress]
        );

        const hasClaimed = registrantResult.rows[0]?.minted === true;
        const claimAmount = parseFloat(registrantResult.rows[0]?.claim_amount) || 2;

        let immediateBonus = 0;
        let bonusTxHash = null;

        // Update registrant with referrer
        await db.pool.query(`
            UPDATE registrants 
            SET referrer_wallet = $1, referrer_code = $2, referrer_set_at = NOW()
            WHERE address = $3
        `, [referrerWallet, code, normalizedAddress]);

        await db.pool.query(`
            UPDATE referral_codes 
            SET total_referrals = total_referrals + 1, updated_at = NOW()
            WHERE code = $1
        `, [code]);

        await db.pool.query(`
            INSERT INTO referrals (referrer_wallet, referrer_code, referred_wallet, signup_bonus_paid, presale_bonus_paid, created_at)
            VALUES ($1, $2, $3, 0, 0, NOW())
            ON CONFLICT (referred_wallet) DO NOTHING
        `, [referrerWallet, code, normalizedAddress]);

        // Mint bonus if user already claimed
        if (hasClaimed && claimAmount > 0) {
            console.log(' User has already claimed, calculating bonus...');
            
            await minter.initialize();
            
            if (settings.bonus_type === 'fixed') {
                immediateBonus = parseFloat(settings.bonus_amount) || 0;
            } else if (settings.bonus_type === 'percentage') {
                immediateBonus = (claimAmount * parseFloat(settings.bonus_amount)) / 100;
            }
            
            if (immediateBonus > 0) {
                try {
                    console.log(` Minting ${immediateBonus} VIP to referrer ${referrerWallet}...`);
                    
                    const bonusResult = await minter.mintToAddress(referrerWallet, immediateBonus, true);
                    bonusTxHash = bonusResult.receipt?.hash || bonusResult.hash || bonusResult.transactionHash;
                    
                    console.log(' Bonus minted! TX:', bonusTxHash);
                    
                    await db.pool.query(`
                        UPDATE referrals 
                        SET signup_bonus_paid = $1
                        WHERE referred_wallet = $2
                    `, [immediateBonus, normalizedAddress]);
                    
                    await db.pool.query(`
                        UPDATE referral_codes 
                        SET total_bonus_earned = total_bonus_earned + $1,
                            total_claims = total_claims + 1,
                            updated_at = NOW()
                        WHERE code = $2
                    `, [immediateBonus, code]);
                    
                } catch (mintError) {
                    console.error(' Failed to mint immediate bonus:', mintError.message);
                }
            }
        }

        const response = {
            success: true,
            message: 'Referrer linked successfully!',
            referrerWallet: `${referrerWallet.slice(0, 6)}...${referrerWallet.slice(-4)}`
        };
        
        if (immediateBonus > 0 && bonusTxHash) {
            response.bonusPaid = {
                amount: immediateBonus,
                txHash: bonusTxHash,
                reason: 'Bonus for previous claim'
            };
            response.message = `Referrer linked! They received ${immediateBonus.toFixed(4)} VIP bonus.`;
        }

        return res.json(response);

    } catch (error) {
        console.error(' SET REFERRER ERROR:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to set referrer' });
    }
});

// Generate referral code for user
router.post('/generate', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        
        console.log('\n🎟️ GENERATE REFERRAL CODE:', { walletAddress });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        const normalizedAddress = walletAddress.toLowerCase();

        const settingsResult = await db.pool.query(
            'SELECT enabled FROM referral_settings WHERE id = 1'
        );
        
        if (!settingsResult.rows[0]?.enabled) {
            return res.status(400).json({ success: false, error: 'Referral program is currently disabled' });
        }

        const existingCode = await db.pool.query(
            'SELECT code, enabled FROM referral_codes WHERE owner_wallet = $1',
            [normalizedAddress]
        );

        if (existingCode.rows.length > 0) {
            return res.json({
                success: true,
                code: existingCode.rows[0].code,
                enabled: existingCode.rows[0].enabled,
                message: 'Referral code already exists'
            });
        }

        let newCode;
        let attempts = 0;

        while (attempts < 10) {
            newCode = generateReferralCode();
            const duplicate = await db.pool.query(
                'SELECT id FROM referral_codes WHERE code = $1',
                [newCode]
            );
            if (duplicate.rows.length === 0) break;
            attempts++;
        }

        if (attempts >= 10) {
            return res.status(500).json({ success: false, error: 'Failed to generate unique code' });
        }

        await db.pool.query(`
            INSERT INTO referral_codes 
            (owner_wallet, code, enabled, total_referrals, total_claims, total_presale_purchases, total_bonus_earned, created_at, updated_at) 
            VALUES ($1, $2, true, 0, 0, 0, 0, NOW(), NOW())
        `, [normalizedAddress, newCode]);

        console.log(' Code generated:', newCode);

        return res.json({
            success: true,
            code: newCode,
            enabled: true,
            message: 'Referral code generated successfully'
        });

    } catch (error) {
        console.error(' GENERATE CODE ERROR:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to generate referral code' });
    }
});

module.exports = router;
