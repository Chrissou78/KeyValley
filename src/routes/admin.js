// src/routes/admin.js
// Admin routes - WalletTwo authentication flow

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const { requireAdminAuth, requireSuperAdmin } = require('../middleware/auth');

// POST /api/admin/auth - Authenticate via WalletTwo
router.post('/auth', async (req, res) => {
    try {
        const { email, walletAddress, name } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check if email is whitelisted
        const whitelistResult = await db.pool.query(
            `SELECT * FROM admin_whitelist WHERE LOWER(email) = $1`,
            [emailLower]
        );
        
        if (whitelistResult.rows.length === 0) {
            console.log(`❌ Admin auth denied for: ${emailLower} (not whitelisted)`);
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Your email is not on the admin whitelist.' 
            });
        }
        
        const admin = whitelistResult.rows[0];
        
        // Update admin with wallet address and last login
        await db.pool.query(`
            UPDATE admin_whitelist 
            SET wallet_address = COALESCE($2, wallet_address),
                name = COALESCE($3, name),
                last_login = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [admin.id, walletAddress?.toLowerCase(), name]);
        
        console.log(`✅ Admin authenticated: ${emailLower} (${admin.role})`);
        
        // Create session data
        const sessionData = {
            id: admin.id,
            email: admin.email,
            role: admin.role,
            name: admin.name || name
        };
        
        // Set session cookie (24 hours)
        res.cookie('admin_session', JSON.stringify(sessionData), {
            httpOnly: true,
            secure: false,
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
                walletAddress: walletAddress || admin.wallet_address
            }
        });
        
    } catch (error) {
        console.error('Admin auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/session - Check current session
router.get('/session', async (req, res) => {
    try {
        const sessionCookie = req.cookies?.admin_session;
        
        if (!sessionCookie) {
            return res.json({ authenticated: false });
        }
        
        const session = typeof sessionCookie === 'string' 
            ? JSON.parse(sessionCookie) 
            : sessionCookie;
        
        // Verify admin still exists and is whitelisted
        const result = await db.pool.query(
            `SELECT id, email, name, role, wallet_address FROM admin_whitelist WHERE id = $1`,
            [session.id]
        );
        
        if (result.rows.length === 0) {
            res.clearCookie('admin_session', { path: '/' });
            return res.json({ authenticated: false });
        }
        
        const admin = result.rows[0];
        
        res.json({
            authenticated: true,
            admin: {
                email: admin.email,
                name: admin.name,
                role: admin.role,
                walletAddress: admin.wallet_address
            }
        });
        
    } catch (error) {
        console.error('Session check error:', error);
        res.json({ authenticated: false });
    }
});

// POST /api/admin/logout - Clear session
router.post('/logout', (req, res) => {
    res.clearCookie('admin_session', { path: '/' });
    res.json({ success: true, message: 'Logged out' });
});

// GET /api/admin/whitelist - List all admins (super_admin only)
router.get('/whitelist', requireAdminAuth, requireSuperAdmin, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, email, name, role, wallet_address, last_login, created_at
            FROM admin_whitelist
            ORDER BY created_at DESC
        `);
        
        res.json({ success: true, admins: result.rows });
    } catch (error) {
        console.error('Error fetching whitelist:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/whitelist - Add new admin (super_admin only)
router.post('/whitelist', requireAdminAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { email, name, role = 'admin' } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check if already exists
        const existing = await db.pool.query(
            `SELECT id FROM admin_whitelist WHERE LOWER(email) = $1`,
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Email already whitelisted' });
        }
        
        // Insert new admin
        const result = await db.pool.query(`
            INSERT INTO admin_whitelist (email, name, role, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id, email, name, role, created_at
        `, [emailLower, name, role]);
        
        console.log(`✅ Admin added to whitelist: ${emailLower} (${role})`);
        
        res.json({ success: true, admin: result.rows[0] });
        
    } catch (error) {
        console.error('Error adding admin:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/admin/whitelist/:email - Remove admin (super_admin only)
router.delete('/whitelist/:email', requireAdminAuth, requireSuperAdmin, async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        
        // Prevent removing yourself
        const session = typeof req.cookies?.admin_session === 'string'
            ? JSON.parse(req.cookies.admin_session)
            : req.cookies?.admin_session;
            
        if (session?.email?.toLowerCase() === emailLower) {
            return res.status(400).json({ success: false, error: 'Cannot remove yourself' });
        }
        
        const result = await db.pool.query(
            `DELETE FROM admin_whitelist WHERE LOWER(email) = $1 RETURNING email`,
            [emailLower]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        
        console.log(`🗑️ Admin removed from whitelist: ${emailLower}`);
        
        res.json({ success: true, message: 'Admin removed' });
        
    } catch (error) {
        console.error('Error removing admin:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// REFERRAL ADMIN ENDPOINTS
// ==========================================

// GET /api/admin/referral/stats - Get referral statistics
router.get('/referral/stats', requireAdminAuth, async (req, res) => {
    try {
        const codesResult = await db.pool.query(`
            SELECT 
                COUNT(*) as total_codes,
                COUNT(*) FILTER (WHERE active = true) as active_codes,
                COALESCE(SUM(use_count), 0) as total_referrals,
                COALESCE(SUM(total_bonus), 0) as total_bonus_earned,
                COALESCE(SUM(claim_count), 0) as total_claims,
                COALESCE(SUM(presale_count), 0) as total_presale_purchases
            FROM referral_codes
        `);
        
        const trackingResult = await db.pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN bonus_type = 'claim' AND bonus_paid = true THEN bonus_amount ELSE 0 END), 0) as signup_bonus_paid,
                COALESCE(SUM(CASE WHEN bonus_type = 'presale' AND bonus_paid = true THEN bonus_amount ELSE 0 END), 0) as presale_bonus_paid
            FROM referral_tracking
        `);
        
        const stats = codesResult.rows[0];
        const tracking = trackingResult.rows[0];
        
        res.json({
            total_codes: parseInt(stats.total_codes) || 0,
            active_codes: parseInt(stats.active_codes) || 0,
            total_referrals: parseInt(stats.total_referrals) || 0,
            total_bonus_earned: parseFloat(stats.total_bonus_earned) || 0,
            total_signup_bonus: parseFloat(tracking.signup_bonus_paid) || 0,
            total_presale_bonus: parseFloat(tracking.presale_bonus_paid) || 0
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        res.status(500).json({ error: 'Failed to get referral stats' });
    }
});

// GET /api/admin/referral/codes - Get all referral codes
router.get('/referral/codes', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                code,
                wallet_address,
                email,
                active as enabled,
                use_count as total_referrals,
                claim_count as total_claims,
                presale_count as total_presale_purchases,
                total_bonus as total_bonus_earned,
                created_at,
                updated_at
            FROM referral_codes
            ORDER BY created_at DESC
        `);
        
        res.json({ codes: result.rows });
    } catch (error) {
        console.error('Error getting referral codes:', error);
        res.status(500).json({ error: 'Failed to get referral codes' });
    }
});

// GET /api/admin/referral/list - Get referral activity
router.get('/referral/list', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                referral_code as referrer_code,
                referrer_wallet,
                referred_wallet as referee_wallet,
                referred_email as referee_email,
                source,
                bonus_type,
                bonus_amount,
                bonus_paid,
                bonus_tx_hash,
                created_at
            FROM referral_tracking
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json({ referrals: result.rows });
    } catch (error) {
        console.error('Error getting referral list:', error);
        res.status(500).json({ error: 'Failed to get referral list' });
    }
});

// POST /api/admin/referral/code/:code/toggle - Toggle referral code status
router.post('/referral/code/:code/toggle', requireAdminAuth, async (req, res) => {
    try {
        const { code } = req.params;
        const { enabled } = req.body;
        
        await db.pool.query(
            'UPDATE referral_codes SET active = $1, updated_at = NOW() WHERE code = $2',
            [enabled, code.toUpperCase()]
        );
        
        res.json({ success: true, message: `Code ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
        console.error('Error toggling referral code:', error);
        res.status(500).json({ success: false, error: 'Failed to toggle referral code' });
    }
});

// ==========================================
// QUESTIONNAIRE ADMIN ENDPOINTS
// ==========================================

// GET /api/admin/questionnaire/export - Export questionnaire responses
router.get('/questionnaire/export', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                q.wallet_address,
                r.email,
                q.is_property_owner,
                q.property_location,
                q.interested_property_index,
                q.interested_property_tour,
                q.interested_members_club,
                q.owns_boat,
                q.interested_yacht_club,
                q.interested_restaurant_review,
                q.created_at,
                q.updated_at
            FROM questionnaire_responses q
            LEFT JOIN registrants r ON q.wallet_address = r.wallet_address
            ORDER BY q.created_at DESC
        `);
        
        res.json({ success: true, responses: result.rows });
    } catch (error) {
        console.error('Error exporting questionnaire:', error);
        res.status(500).json({ success: false, error: 'Failed to export questionnaire data' });
    }
});

// GET /api/admin/questionnaire/stats - Get questionnaire statistics
router.get('/questionnaire/stats', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                COUNT(*) as total_responses,
                COUNT(*) FILTER (WHERE is_property_owner = true) as property_owners,
                COUNT(*) FILTER (WHERE interested_property_index = true) as interested_property_index,
                COUNT(*) FILTER (WHERE interested_property_tour = true) as interested_property_tour,
                COUNT(*) FILTER (WHERE interested_members_club = true) as interested_members_club,
                COUNT(*) FILTER (WHERE owns_boat = true) as boat_owners,
                COUNT(*) FILTER (WHERE interested_yacht_club = true) as interested_yacht_club,
                COUNT(*) FILTER (WHERE interested_restaurant_review = true) as interested_restaurant_review
            FROM questionnaire_responses
        `);
        
        res.json({ success: true, stats: result.rows[0] });
    } catch (error) {
        console.error('Error getting questionnaire stats:', error);
        res.status(500).json({ success: false, error: 'Failed to get questionnaire stats' });
    }
});

module.exports = router;
