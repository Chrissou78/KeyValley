// src/routes/admin.js
// Admin routes - WalletTwo authentication flow
// VERSION: 2026-05-22 - Fixed member names, vouchers, memberships display

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

// ==========================================
// HEALTH CHECK ENDPOINT
// ==========================================
router.get('/health', async (req, res) => {
    const health = {
        success: true,
        database: false,
        stripe: false,
        walletTwo: false,
        counts: { members: 0, orders: 0 }
    };
    
    try {
        await db.pool.query('SELECT 1');
        health.database = true;
        const members = await db.pool.query('SELECT COUNT(*) FROM member_balances');
        const orders = await db.pool.query('SELECT COUNT(*) FROM marketplace_orders');
        health.counts.members = parseInt(members.rows[0].count) || 0;
        health.counts.orders = parseInt(orders.rows[0].count) || 0;
    } catch (e) {
        console.error('DB health failed:', e.message);
    }
    
    health.stripe = !!process.env.STRIPE_SECRET_KEY;
    health.walletTwo = !!(process.env.WALLETTWO_API_KEY || process.env.WALLETTWO_EMAIL_WEBHOOK);
    
    res.json(health);
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
// DASHBOARD OVERVIEW
// ==========================================

router.get('/overview', requireAdminAuth, async (req, res) => {
    try {
        // Stats
        const revenueResult = await db.pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total 
            FROM marketplace_orders WHERE status = 'completed'
        `);
        const ordersResult = await db.pool.query('SELECT COUNT(*) FROM marketplace_orders');
        const pendingResult = await db.pool.query(`SELECT COUNT(*) FROM marketplace_orders WHERE status = 'pending'`);
        const membersResult = await db.pool.query('SELECT COUNT(*) FROM member_balances');
        const vouchersResult = await db.pool.query(`SELECT COUNT(*) FROM marketplace_vouchers WHERE status = 'active'`);
        
        // Revenue by period
        const todayResult = await db.pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total 
            FROM marketplace_orders 
            WHERE status = 'completed' AND created_at >= CURRENT_DATE
        `);
        const weekResult = await db.pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total 
            FROM marketplace_orders 
            WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'
        `);
        const monthResult = await db.pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total 
            FROM marketplace_orders 
            WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);
        
        // Recent orders with member info
        const recentOrdersResult = await db.pool.query(`
            SELECT o.*, 
                   r.email AS member_email,
                   r.metadata->>'name' AS member_name
            FROM marketplace_orders o
            LEFT JOIN registrants r ON LOWER(r.wallet_address) = LOWER(o.wallet_address)
            ORDER BY o.created_at DESC 
            LIMIT 5
        `);
        
        // Recent memberships with member info
        const recentMembershipsResult = await db.pool.query(`
            SELECT mp.*,
                   r.email AS member_email,
                   r.metadata->>'name' AS member_name
            FROM membership_purchases mp
            LEFT JOIN registrants r ON LOWER(r.wallet_address) = LOWER(mp.metadata->>'wallet_address')
            ORDER BY mp.created_at DESC 
            LIMIT 5
        `);
        
        res.json({
            success: true,
            stats: {
                totalRevenue: parseFloat(revenueResult.rows[0].total) || 0,
                totalOrders: parseInt(ordersResult.rows[0].count) || 0,
                pendingOrders: parseInt(pendingResult.rows[0].count) || 0,
                totalMembers: parseInt(membersResult.rows[0].count) || 0,
                activeVouchers: parseInt(vouchersResult.rows[0].count) || 0,
                revenueToday: parseFloat(todayResult.rows[0].total) || 0,
                revenueWeek: parseFloat(weekResult.rows[0].total) || 0,
                revenueMonth: parseFloat(monthResult.rows[0].total) || 0
            },
            recentOrders: recentOrdersResult.rows,
            recentMemberships: recentMembershipsResult.rows
        });
    } catch (error) {
        console.error('Error fetching overview:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ORDERS
// ==========================================

router.get('/orders', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                o.*,
                r.email AS member_email,
                r.metadata->>'name' AS member_name
            FROM marketplace_orders o
            LEFT JOIN registrants r ON LOWER(r.wallet_address) = LOWER(o.wallet_address)
            ORDER BY o.created_at DESC
        `);
        
        res.json({ success: true, orders: result.rows });
    } catch (error) {
        console.error('Error fetching orders:', error);
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
        const { name, short_description, description, category, price, price_note, pricing_options, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days } = req.body;

        console.log('📦 Creating service with image_url:', image_url);

        const result = await db.pool.query(`
            INSERT INTO marketplace_services
            (name, short_description, description, category, price, price_note, pricing_options, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
        `, [name, short_description, description, category, price, price_note, pricing_options || '[]', image_url, location, features, is_active ?? true, max_quantity ?? 10, booking_type || 'none', slots_per_day || 1, booking_start_time || '09:00', booking_end_time || '18:00', slot_duration_minutes || 60, available_days || '1,2,3,4,5,6,0']);
        
        console.log('✅ Service created:', result.rows[0].name, 'image:', result.rows[0].image_url);
        
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Create service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/services/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, short_description, description, category, price, price_note, pricing_options, image_url, location, features, is_active, max_quantity, booking_type, slots_per_day, booking_start_time, booking_end_time, slot_duration_minutes, available_days } = req.body;

        console.log('📦 Updating service', id, 'with image_url:', image_url);

        const result = await db.pool.query(`
            UPDATE marketplace_services SET
                name = $1, short_description = $2, description = $3, category = $4,
                price = $5, price_note = $6, pricing_options = $7, image_url = $8, location = $9,
                features = $10, is_active = $11, max_quantity = $12,
                booking_type = $13, slots_per_day = $14, booking_start_time = $15,
                booking_end_time = $16, slot_duration_minutes = $17, available_days = $18,
                updated_at = NOW()
            WHERE id = $19 RETURNING *
        `, [name, short_description, description, category, price, price_note, pricing_options || '[]', image_url, location, features, is_active, max_quantity, booking_type || 'none', slots_per_day || 1, booking_start_time || '09:00', booking_end_time || '18:00', slot_duration_minutes || 60, available_days || '1,2,3,4,5,6,0', id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Service not found' });
        }
        
        console.log('✅ Service updated:', result.rows[0].name, 'image:', result.rows[0].image_url);
        
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/services/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get service image before deleting
        const serviceResult = await db.pool.query(
            'SELECT image_url FROM marketplace_services WHERE id = $1',
            [id]
        );
        
        const imageUrl = serviceResult.rows[0]?.image_url;
        
        // Check if service has vouchers
        const voucherCheck = await db.pool.query(
            'SELECT COUNT(*) FROM marketplace_vouchers WHERE service_id = $1',
            [id]
        );
        
        if (parseInt(voucherCheck.rows[0].count) > 0) {
            // Soft delete - just deactivate (keep image)
            await db.pool.query(
                'UPDATE marketplace_services SET is_active = false, updated_at = NOW() WHERE id = $1',
                [id]
            );
            return res.json({ success: true, softDeleted: true, message: 'Service deactivated (has vouchers)' });
        }
        
        // Hard delete
        await db.pool.query('DELETE FROM marketplace_services WHERE id = $1', [id]);
        
        // Delete image file if exists
        if (imageUrl && imageUrl.startsWith('/images/services/')) {
            const fileName = imageUrl.replace('/images/services/', '');
            const defaultImages = ['villa.jpg', 'yacht.jpg', 'chef.jpg', 'spa.jpg', 'transfer.jpg', 'wine.jpg', 'helicopter.jpg', 'training.jpg', 'dinner.jpg', 'scuba.jpg', 'meal.png'];
            
            if (!defaultImages.includes(fileName)) {
                const filePath = path.join(__dirname, '../public/images/services', fileName);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log('🗑️ Deleted image:', fileName);
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MEMBERSHIPS - FIXED: Show member name/email
// ==========================================

router.get('/memberships', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                mp.*,
                mp.metadata->>'email' as meta_email,
                mp.metadata->>'wallet_address' as meta_wallet,
                r.email as registrant_email,
                r.metadata->>'name' as registrant_name
            FROM membership_purchases mp
            LEFT JOIN registrants r ON LOWER(r.wallet_address) = LOWER(mp.metadata->>'wallet_address')
            ORDER BY mp.created_at DESC
        `);
        
        const memberships = result.rows.map(m => ({
            ...m,
            member_name: m.registrant_name || m.meta_email || null,
            member_email: m.registrant_email || m.meta_email || null,
            wallet_address: m.meta_wallet || null
        }));
        
        res.json({ success: true, memberships });
    } catch (error) {
        console.error('Memberships error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MEMBERS - FIXED: Name first, email, proper balance ops
// ==========================================

router.get('/members', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                mb.wallet_address,
                mb.balance,
                COALESCE(mb.total_credited, 0) AS total_credited,
                COALESCE(mb.total_spent, 0) AS total_spent,
                r.email,
                r.metadata->>'name' AS name,
                r.registered_at AS created_at,
                (SELECT COUNT(*) FROM marketplace_orders mo 
                 WHERE LOWER(mo.wallet_address) = LOWER(mb.wallet_address)) AS order_count,
                (SELECT COUNT(*) FROM marketplace_vouchers mv 
                 WHERE LOWER(mv.wallet_address) = LOWER(mb.wallet_address)) AS voucher_count
            FROM member_balances mb
            LEFT JOIN registrants r ON LOWER(r.wallet_address) = LOWER(mb.wallet_address)
            ORDER BY mb.balance DESC
        `);
        
        res.json({ success: true, members: result.rows });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/members/add-balance - Mint tokens to member
router.post('/members/add-balance', requireAdminAuth, async (req, res) => {
    const { wallet_address, amount, reason } = req.body;
    
    if (!wallet_address || !amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid wallet or amount' });
    }
    
    try {
        const walletLower = wallet_address.toLowerCase();
        
        // 1. Mint tokens on-chain
        const { ethers } = require('ethers');
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
        const minterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        
        const tokenContract = new ethers.Contract(
            process.env.TOKEN_ADDRESS_POLYGON,
            ['function mint(address to, uint256 amount) external'],
            minterWallet
        );
        
        console.log(`🪙 Minting ${amount} tokens to ${walletLower}`);
        const mintAmount = ethers.parseUnits(amount.toString(), 18);
        const tx = await tokenContract.mint(wallet_address, mintAmount);
        await tx.wait();
        console.log(`✅ Minted! TX: ${tx.hash}`);
        
        // 2. Update DB balance
        const result = await db.pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = COALESCE(member_balances.total_credited, 0) + $2,
                updated_at = NOW()
            RETURNING balance
        `, [walletLower, amount]);
        
        // 3. Log the adjustment (ignore if table doesn't exist)
        try {
            await db.pool.query(`
                INSERT INTO balance_adjustments (wallet_address, amount, type, reason, tx_hash, created_by, created_at)
                VALUES ($1, $2, 'credit', $3, $4, $5, NOW())
            `, [walletLower, amount, reason || 'Manual addition', tx.hash, req.adminSession?.email || 'admin']);
        } catch (logError) {
            console.log('Note: balance_adjustments table may not exist');
        }
        
        res.json({ 
            success: true, 
            new_balance: parseFloat(result.rows[0].balance),
            tx_hash: tx.hash
        });
    } catch (error) {
        console.error('Add balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/members/remove-balance - Deduct from DB (no burn)
router.post('/members/remove-balance', requireAdminAuth, async (req, res) => {
    const { wallet_address, amount, reason } = req.body;
    
    if (!wallet_address || !amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Valid wallet and positive amount required' });
    }
    
    try {
        const current = await db.pool.query(
            'SELECT balance, total_spent FROM member_balances WHERE LOWER(wallet_address) = LOWER($1)',
            [wallet_address]
        );
        
        if (!current.rows.length) {
            return res.status(404).json({ success: false, error: 'Member not found' });
        }
        
        const currentBalance = parseFloat(current.rows[0].balance) || 0;
        const currentSpent = parseFloat(current.rows[0].total_spent) || 0;
        
        if (amount > currentBalance) {
            return res.status(400).json({ 
                success: false, 
                error: `Insufficient balance. Current: ${currentBalance} KEA` 
            });
        }
        
        const newBalance = currentBalance - amount;
        const newSpent = currentSpent + amount;
        
        await db.pool.query(
            `UPDATE member_balances 
             SET balance = $1, total_spent = $2, updated_at = NOW() 
             WHERE LOWER(wallet_address) = LOWER($3)`,
            [newBalance, newSpent, wallet_address]
        );
        
        console.log(`➖ Removed ${amount} KEA from ${wallet_address} | Reason: ${reason || 'Manual'} | New balance: ${newBalance}`);
        
        res.json({ 
            success: true, 
            new_balance: newBalance,
            message: `Removed ${amount} Kea Euros`
        });
    } catch (error) {
        console.error('Error removing balance:', error);
        res.status(500).json({ success: false, error: 'Failed to remove balance' });
    }
});

// Legacy adjust-balance endpoint (for backward compatibility)
router.post('/members/adjust-balance', requireAdminAuth, async (req, res) => {
    try {
        const { wallet_address, amount, reason } = req.body;
        
        if (amount > 0) {
            // Redirect to add-balance
            req.body.amount = Math.abs(amount);
            return router.handle(req, res, () => {});
        }
        
        // For negative amounts, just update DB (no mint)
        await db.pool.query(`
            INSERT INTO member_balances (wallet_address, balance, updated_at)
            VALUES (LOWER($1), $2, NOW())
            ON CONFLICT (wallet_address) 
            DO UPDATE SET balance = member_balances.balance + $2, updated_at = NOW()
        `, [wallet_address, amount]);
        
        res.json({ success: true, message: 'Balance adjusted' });
    } catch (error) {
        console.error('Adjust balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// VOUCHERS - FIXED: Show member name/email
// ==========================================

router.get('/vouchers', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                v.*,
                r.email as member_email,
                r.metadata->>'name' as member_name
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
// ADMINS
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
// PACKAGES
// ==========================================

router.get('/packages', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT * FROM membership_packages ORDER BY sort_order ASC, price ASC
        `);
        
        const packages = result.rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: parseFloat(p.price),
            buyingPower: parseFloat(p.buying_power),
            bonus: parseFloat(p.bonus || 0),
            bonusPercent: p.price > 0 ? Math.round(((p.buying_power - p.price) / p.price) * 100) : 0,
            tier: p.tier,
            icon: p.icon,
            features: p.features || [],
            active: p.active,
            popular: p.popular,
            testOnly: p.test_only,
            sortOrder: p.sort_order
        }));
        
        res.json({ success: true, packages });
    } catch (error) {
        console.error('Packages error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/packages', requireAdminAuth, async (req, res) => {
    try {
        const { id, name, description, price, buyingPower, bonus, tier, icon, features, active, popular, testOnly, sortOrder } = req.body;
        
        const result = await db.pool.query(`
            INSERT INTO membership_packages 
            (id, name, description, price, buying_power, bonus, tier, icon, features, active, popular, test_only, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [id, name, description, price, buyingPower, bonus || 0, tier || 'standard', icon || 'card_membership', features || [], active !== false, popular || false, testOnly || false, sortOrder || 0]);
        
        res.json({ success: true, package: result.rows[0] });
    } catch (error) {
        console.error('Create package error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/packages/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, buyingPower, bonus, tier, icon, features, active, popular, testOnly, sortOrder } = req.body;
        
        const result = await db.pool.query(`
            UPDATE membership_packages SET
                name = $1, description = $2, price = $3, buying_power = $4, bonus = $5,
                tier = $6, icon = $7, features = $8, active = $9, popular = $10,
                test_only = $11, sort_order = $12, updated_at = NOW()
            WHERE id = $13 RETURNING *
        `, [name, description, price, buyingPower, bonus || 0, tier || 'standard', icon || 'card_membership', features || [], active, popular || false, testOnly || false, sortOrder || 0, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }
        
        res.json({ success: true, package: result.rows[0] });
    } catch (error) {
        console.error('Update package error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/packages/:id/toggle', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.pool.query(`
            UPDATE membership_packages SET active = NOT active, updated_at = NOW()
            WHERE id = $1 RETURNING active
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }
        
        res.json({ success: true, active: result.rows[0].active });
    } catch (error) {
        console.error('Toggle package error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/packages/:id', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if package has purchases
        const purchaseCheck = await db.pool.query(
            'SELECT COUNT(*) FROM membership_purchases WHERE package = $1',
            [id]
        );
        
        if (parseInt(purchaseCheck.rows[0].count) > 0) {
            // Soft delete - just deactivate
            await db.pool.query('UPDATE membership_packages SET active = false WHERE id = $1', [id]);
            return res.json({ success: true, softDeleted: true, message: 'Package deactivated (has purchases)' });
        }
        
        await db.pool.query('DELETE FROM membership_packages WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete package error:', error);
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

// ==========================================
// IMAGE UPLOAD
// ==========================================

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
        
        // Don't delete the default images
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
// REFERRALS (keeping existing implementation)
// ==========================================

router.get('/referral/stats', requireAdminAuth, async (req, res) => {
    try {
        const codesResult = await db.pool.query(`
            SELECT 
                COUNT(*) as total_codes,
                COUNT(*) FILTER (WHERE active = true) as active_codes,
                COALESCE(SUM(use_count), 0) as total_referrals,
                COALESCE(SUM(total_bonus), 0) as total_bonus_earned
            FROM referral_codes
        `);
        
        const stats = codesResult.rows[0];
        
        res.json({
            total_codes: parseInt(stats.total_codes) || 0,
            active_codes: parseInt(stats.active_codes) || 0,
            total_referrals: parseInt(stats.total_referrals) || 0,
            total_bonus_earned: parseFloat(stats.total_bonus_earned) || 0
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        res.status(500).json({ error: 'Failed to get referral stats' });
    }
});

router.get('/referral/codes', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                code,
                wallet_address,
                email,
                active as enabled,
                use_count as total_referrals,
                total_bonus as total_bonus_earned,
                created_at
            FROM referral_codes
            ORDER BY created_at DESC
        `);
        
        res.json({ codes: result.rows });
    } catch (error) {
        console.error('Error getting referral codes:', error);
        res.status(500).json({ error: 'Failed to get referral codes' });
    }
});

router.get('/referral/list', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                referral_code as referrer_code,
                referrer_wallet,
                referred_wallet as referee_wallet,
                referred_email as referee_email,
                bonus_type,
                bonus_amount,
                bonus_paid,
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

module.exports = router;
