// src/routes/admin.js
// Admin routes - WalletTwo authentication flow

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const { requireAdminAuth, requireSuperAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload folder if it doesn't exist
const uploadDir = path.join(__dirname, '../public/images/services');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure image upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images allowed'));
        }
    }
});

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

// ==========================================
// DASHBOARD OVERVIEW
// ==========================================

router.get('/overview', requireAdminAuth, async (req, res) => {
    try {
        const [revenue, orders, members, vouchers, recentOrders, recentMemberships] = await Promise.all([
            db.pool.query(`
                SELECT 
                    COALESCE(SUM(total_amount), 0) as total,
                    COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_amount ELSE 0 END), 0) as today,
                    COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN total_amount ELSE 0 END), 0) as week,
                    COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN total_amount ELSE 0 END), 0) as month
                FROM marketplace_orders WHERE status != 'cancelled'
            `),
            db.pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
                FROM marketplace_orders 
            `),
            db.pool.query('SELECT COUNT(*) as total FROM registrants'),
            db.pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active
                FROM marketplace_vouchers
            `).catch(() => ({ rows: [{ total: 0, active: 0 }] })),
            db.pool.query('SELECT * FROM marketplace_orders  ORDER BY created_at DESC LIMIT 5').catch(() => ({ rows: [] })),
            db.pool.query('SELECT * FROM membership_purchases ORDER BY created_at DESC LIMIT 5').catch(() => ({ rows: [] }))
        ]);

        res.json({
            success: true,
            stats: {
                totalRevenue: parseFloat(revenue.rows[0]?.total || 0),
                revenueToday: parseFloat(revenue.rows[0]?.today || 0),
                revenueWeek: parseFloat(revenue.rows[0]?.week || 0),
                revenueMonth: parseFloat(revenue.rows[0]?.month || 0),
                totalOrders: parseInt(orders.rows[0]?.total || 0),
                pendingOrders: parseInt(orders.rows[0]?.pending || 0),
                totalMembers: parseInt(members.rows[0]?.total || 0),
                totalVouchers: parseInt(vouchers.rows[0]?.total || 0),
                activeVouchers: parseInt(vouchers.rows[0]?.active || 0)
            },
            recentOrders: recentOrders.rows,
            recentMemberships: recentMemberships.rows
        });
    } catch (error) {
        console.error('Overview error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ORDERS
// ==========================================

router.get('/orders', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT o.*, r.email
            FROM marketplace_orders o
            LEFT JOIN registrants r ON LOWER(o.wallet_address) = LOWER(r.wallet_address)
            ORDER BY o.created_at DESC
        `);
        res.json({ success: true, orders: result.rows });
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/orders/:id/status', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const result = await db.pool.query(
            'UPDATE marketplace_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        
        res.json({ success: true, order: result.rows[0] });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// SERVICES (MARKETPLACE)
// ==========================================

router.get('/services', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM marketplace_services ORDER BY category, name');
        res.json({ success: true, services: result.rows });
    } catch (error) {
        console.error('Services error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/services', requireAdminAuth, async (req, res) => {
    try {
        const { name, short_description, description, category, price, price_note, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days } = req.body;
        
        const result = await db.pool.query(`
            INSERT INTO marketplace_services 
            (name, short_description, description, category, price, price_note, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `, [name, short_description, description, category, price, price_note, image_url, location, features, is_active ?? true, max_quantity ?? 10, booking_type || 'none', slots_per_day || 1, booking_start_time || '09:00', booking_end_time || '18:00', slot_duration_minutes || 60, available_days || '1,2,3,4,5,6,0']);
        
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Create service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/services/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, short_description, description, category, price, price_note, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days } = req.body;
        
        const result = await db.pool.query(`
            UPDATE marketplace_services SET
                name = $1, short_description = $2, description = $3, category = $4,
                price = $5, price_note = $6, image_url = $7, location = $8,
                features = $9, is_active = $10, max_quantity = $11, 
                booking_type = $12, slots_per_day = $13, booking_start_time = $14,
                booking_end_time = $15, slot_duration_minutes = $16, available_days = $17,
                updated_at = NOW()
            WHERE id = $18 RETURNING *
        `, [name, short_description, description, category, price, price_note, image_url, location, features, is_active, max_quantity, booking_type || 'none', slots_per_day || 1, booking_start_time || '09:00', booking_end_time || '18:00', slot_duration_minutes || 60, available_days || '1,2,3,4,5,6,0', id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Service not found' });
        }
        
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/services/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await db.pool.query('DELETE FROM marketplace_services WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MEMBERSHIPS
// ==========================================

router.get('/memberships', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT *
            FROM membership_purchases
            ORDER BY created_at DESC
        `);
        res.json({ success: true, memberships: result.rows });
    } catch (error) {
        console.error('Memberships error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MEMBERS (REGISTRANTS)
// ==========================================

router.get('/members', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                r.id,
                r.wallet_address,
                r.email,
                r.registered_at as created_at,
                COALESCE(mb.balance, 0) as balance,
                COALESCE(mb.total_spent, 0) as total_spent
            FROM registrants r
            LEFT JOIN member_balances mb ON LOWER(r.wallet_address) = LOWER(mb.wallet_address)
            ORDER BY r.registered_at DESC
        `);
        res.json({ success: true, members: result.rows });
    } catch (error) {
        console.error('Members error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/members/adjust-balance', requireAdminAuth, async (req, res) => {
    try {
        const { wallet_address, amount, reason } = req.body;
        
        // Update or insert token balance
        await db.pool.query(`
            INSERT INTO member_balances (wallet_address, balance, updated_at)
            VALUES (LOWER($1), $2, NOW())
            ON CONFLICT (wallet_address) 
            DO UPDATE SET balance = token_balances.balance + $2, updated_at = NOW()
        `, [wallet_address, amount]);
        
        // Log the adjustment
        await db.pool.query(`
            INSERT INTO balance_adjustments (wallet_address, amount, reason, admin_email, created_at)
            VALUES (LOWER($1), $2, $3, $4, NOW())
        `, [wallet_address, amount, reason, req.adminSession?.email]).catch(() => {});
        
        res.json({ success: true, message: 'Balance adjusted' });
    } catch (error) {
        console.error('Adjust balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// VOUCHERS
// ==========================================

router.get('/vouchers', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT v.*, r.email
            FROM marketplace_vouchers v
            LEFT JOIN registrants r ON LOWER(v.wallet_address) = LOWER(r.wallet_address)
            ORDER BY v.created_at DESC
        `);
        res.json({ success: true, vouchers: result.rows });
    } catch (error) {
        console.error('Vouchers error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/vouchers/:id/redeem', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.pool.query(
            'UPDATE marketplace_vouchers SET status = $1, redeemed_at = NOW() WHERE id = $2 RETURNING *',
            ['redeemed', id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        res.json({ success: true, voucher: result.rows[0] });
    } catch (error) {
        console.error('Redeem voucher error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ADMINS (uses whitelist routes above)
// ==========================================

router.get('/admins', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, email, name, role, wallet_address, last_login, created_at
            FROM admin_whitelist
            ORDER BY created_at DESC
        `);
        res.json({ success: true, admins: result.rows });
    } catch (error) {
        console.error('Admins error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// SETTINGS
// ==========================================

router.get('/settings', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM app_settings');
        const settings = {};
        result.rows.forEach(s => { settings[s.key] = s.value; });
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Settings error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/settings', requireAdminAuth, async (req, res) => {
    try {
        const updates = req.body;
        
        for (const [key, value] of Object.entries(updates)) {
            await db.pool.query(
                'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                [key, value]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/upload/service-image', requireAdminAuth, upload.single('image'), (req, res) => {
    console.log('📸 Upload request received');
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    
    // Delete old image if provided
    const oldImageUrl = req.body.oldImageUrl;
    if (oldImageUrl && oldImageUrl.startsWith('/images/services/')) {
        const oldFileName = oldImageUrl.replace('/images/services/', '');
        const oldFilePath = path.join(uploadDir, oldFileName);
        
        // Don't delete the default images (villa.jpg, yacht.jpg, etc.)
        const defaultImages = ['villa.jpg', 'yacht.jpg', 'chef.jpg', 'spa.jpg', 'transfer.jpg', 'wine.jpg', 'helicopter.jpg', 'training.jpg', 'dinner.jpg', 'scuba.jpg'];
        
        if (!defaultImages.includes(oldFileName) && fs.existsSync(oldFilePath)) {
            fs.unlink(oldFilePath, (err) => {
                if (err) console.error('Failed to delete old image:', err);
                else console.log('🗑️ Deleted old image:', oldFileName);
            });
        }
    }
    
    const imageUrl = `/images/services/${req.file.filename}`;
    console.log('✅ Image uploaded:', imageUrl);
    res.json({ success: true, imageUrl });
});

// ==========================================
// VOUCHER BOOKINGS MANAGEMENT
// ==========================================

// GET /api/admin/bookings - All booking requests
router.get('/bookings', requireAdminAuth, async (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT vb.*, 
                   mo.order_number,
                   mo.email as order_email
            FROM voucher_bookings vb
            LEFT JOIN marketplace_orders mo ON vb.order_id = mo.id
        `;
        
        const params = [];
        if (status && status !== 'all') {
            query += ' WHERE vb.status = $1';
            params.push(status);
        }
        
        query += ' ORDER BY vb.created_at DESC';
        
        const result = await db.pool.query(query, params);
        
        res.json({ success: true, bookings: result.rows });
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/bookings/:id/confirm - Confirm booking
router.post('/bookings/:id/confirm', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const adminEmail = req.adminSession?.email || 'admin';
        
        const result = await db.pool.query(`
            UPDATE voucher_bookings
            SET status = 'confirmed',
                responded_by = $2,
                responded_at = NOW(),
                updated_at = NOW()
            WHERE id = $1 AND status = 'pending_confirmation'
            RETURNING *
        `, [id, adminEmail]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Booking not found or already processed' 
            });
        }
        
        const booking = result.rows[0];
        
        // Send confirmation email to user
        // (You can import and call sendBookingConfirmedToUser here)
        
        res.json({ success: true, booking });
    } catch (error) {
        console.error('Error confirming booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/bookings/:id/reject - Reject booking
router.post('/bookings/:id/reject', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminEmail = req.adminSession?.email || 'admin';
        
        const result = await db.pool.query(`
            UPDATE voucher_bookings
            SET status = 'rejected',
                responded_by = $2,
                responded_at = NOW(),
                rejection_reason = $3,
                updated_at = NOW()
            WHERE id = $1 AND status = 'pending_confirmation'
            RETURNING *
        `, [id, adminEmail, reason || 'Date not available']);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Booking not found or already processed' 
            });
        }
        
        const booking = result.rows[0];
        
        // Send rejection email to user
        // (You can import and call sendBookingRejectedToUser here)
        
        res.json({ success: true, booking });
    } catch (error) {
        console.error('Error rejecting booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/bookings/:id/redeem - Mark voucher as redeemed
router.post('/bookings/:id/redeem', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const adminEmail = req.adminSession?.email || 'admin';
        
        const result = await db.pool.query(`
            UPDATE voucher_bookings
            SET status = 'redeemed',
                redeemed_at = NOW(),
                responded_by = $2,
                updated_at = NOW()
            WHERE id = $1 AND status = 'confirmed'
            RETURNING *
        `, [id, adminEmail]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Booking not found or not confirmed' 
            });
        }
        
        res.json({ success: true, message: 'Voucher marked as redeemed' });
    } catch (error) {
        console.error('Error redeeming voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/referrals', requireAdminAuth, async (req, res) => {
    try {
        const [codes, activity, stats] = await Promise.all([
            db.pool.query(`
                SELECT 
                    code,
                    owner_wallet as wallet_address,
                    owner_email as email,
                    enabled,
                    total_referrals,
                    total_claims,
                    total_presale_purchases,
                    total_bonus_earned,
                    created_at,
                    updated_at
                FROM referral_codes
                ORDER BY created_at DESC
            `),
            db.pool.query(`
                SELECT 
                    referral_code,
                    referrer_wallet,
                    referred_wallet,
                    referred_email,
                    bonus_type,
                    bonus_amount,
                    bonus_paid,
                    created_at
                FROM referral_tracking
                ORDER BY created_at DESC
                LIMIT 50
            `),
            db.pool.query(`
                SELECT 
                    COUNT(*) as total_codes,
                    COUNT(*) FILTER (WHERE enabled = true) as active_codes,
                    COALESCE(SUM(total_referrals), 0) as total_referrals,
                    COALESCE(SUM(total_bonus_earned), 0) as total_bonus
                FROM referral_codes
            `)
        ]);

        res.json({
            success: true,
            codes: codes.rows,
            activity: activity.rows,
            stats: stats.rows[0]
        });
    } catch (error) {
        console.error('Referrals error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
