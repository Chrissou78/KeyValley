// src/routes/admin-referral.js
// Admin referral management routes

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const { requireAdminAuth } = require('../middleware/auth');

// GET /api/admin/referral/stats
router.get('/stats', requireAdminAuth, async (req, res) => {
    try {
        const totalCodes = await db.pool.query('SELECT COUNT(*) FROM referral_codes');
        const activeCodes = await db.pool.query('SELECT COUNT(*) FROM referral_codes WHERE enabled = true');
        const totalReferrals = await db.pool.query('SELECT COUNT(*) FROM referrals');
        const totalBonus = await db.pool.query('SELECT COALESCE(SUM(total_bonus_earned), 0) as total FROM referral_codes');

        res.json({
            success: true,
            stats: {
                totalCodes: parseInt(totalCodes.rows[0].count),
                activeCodes: parseInt(activeCodes.rows[0].count),
                totalReferrals: parseInt(totalReferrals.rows[0].count),
                totalBonus: parseFloat(totalBonus.rows[0].total) || 0
            }
        });
    } catch (error) {
        console.error('Admin referral stats error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/referral/codes
router.get('/codes', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, code, owner_wallet, owner_email, enabled,
                total_referrals, total_claims, total_presale_purchases,
                total_bonus_earned, created_at, updated_at
            FROM referral_codes
            ORDER BY created_at DESC
            LIMIT 500
        `);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        console.error('Admin referral codes error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/referral/list
router.get('/list', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, referrer_wallet, referrer_code, referred_wallet, referred_email,
                source, signup_bonus_paid, signup_bonus_amount, presale_bonus_paid,
                presale_bonus_amount, created_at
            FROM referrals
            ORDER BY created_at DESC
            LIMIT 500
        `);
        res.json({ success: true, referrals: result.rows });
    } catch (error) {
        console.error('Admin referral list error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/referral/activity
router.get('/activity', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                r.id, r.referrer_wallet, r.referrer_code, r.referred_wallet, 
                r.referred_email, r.source, r.signup_bonus_amount, r.presale_bonus_amount,
                r.created_at,
                rc.owner_email as referrer_email
            FROM referrals r
            LEFT JOIN referral_codes rc ON r.referrer_code = rc.code
            ORDER BY r.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, activity: result.rows });
    } catch (error) {
        console.error('Admin referral activity error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/referral/code/:code/toggle
router.post('/code/:code/toggle', requireAdminAuth, async (req, res) => {
    try {
        const { code } = req.params;
        
        const result = await db.pool.query(`
            UPDATE referral_codes 
            SET enabled = NOT enabled, updated_at = NOW()
            WHERE code = $1
            RETURNING code, enabled
        `, [code]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Code not found' });
        }

        res.json({ success: true, code: result.rows[0] });
    } catch (error) {
        console.error('Toggle referral code error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/referral/create-code
router.post('/create-code', requireAdminAuth, async (req, res) => {
    try {
        const { code, ownerWallet, ownerEmail } = req.body;

        if (!code || !ownerWallet) {
            return res.status(400).json({ success: false, error: 'Code and owner wallet required' });
        }

        const result = await db.pool.query(`
            INSERT INTO referral_codes (code, owner_wallet, owner_email, enabled, created_at, updated_at)
            VALUES ($1, $2, $3, true, NOW(), NOW())
            RETURNING *
        `, [code.toUpperCase(), ownerWallet.toLowerCase(), ownerEmail?.toLowerCase()]);

        res.json({ success: true, code: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Code already exists' });
        }
        console.error('Create referral code error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/referral/settings
router.get('/settings', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM referral_settings LIMIT 1');
        res.json({ success: true, settings: result.rows[0] || {} });
    } catch (error) {
        console.error('Get referral settings error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/referral/settings
router.post('/settings', requireAdminAuth, async (req, res) => {
    try {
        const { enabled, bonus_type, bonus_amount, presale_bonus_type, presale_bonus_amount, min_purchase_for_bonus } = req.body;

        const result = await db.pool.query(`
            UPDATE referral_settings 
            SET enabled = COALESCE($1, enabled),
                bonus_type = COALESCE($2, bonus_type),
                bonus_amount = COALESCE($3, bonus_amount),
                presale_bonus_type = COALESCE($4, presale_bonus_type),
                presale_bonus_amount = COALESCE($5, presale_bonus_amount),
                min_purchase_for_bonus = COALESCE($6, min_purchase_for_bonus),
                updated_at = NOW()
            RETURNING *
        `, [enabled, bonus_type, bonus_amount, presale_bonus_type, presale_bonus_amount, min_purchase_for_bonus]);

        res.json({ success: true, settings: result.rows[0] });
    } catch (error) {
        console.error('Update referral settings error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
