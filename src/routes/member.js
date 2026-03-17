// src/routes/member.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/member/vouchers/:wallet
router.get('/vouchers/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const result = await pool.query(`
            SELECT 
                v.id, v.code, v.service_name, v.value, 
                v.valid_from, v.valid_until, v.status, v.redeemed_at,
                s.image_url, s.category
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE v.wallet_address = $1
            ORDER BY v.created_at DESC
        `, [wallet]);

        res.json({
            success: true,
            vouchers: result.rows
        });
    } catch (error) {
        console.error('Error fetching vouchers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch vouchers' });
    }
});

// GET /api/member/orders/:wallet
router.get('/orders/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const result = await pool.query(`
            SELECT 
                id, order_number, items, total_amount, 
                payment_method, status, created_at
            FROM marketplace_orders
            WHERE wallet_address = $1
            ORDER BY created_at DESC
        `, [wallet]);

        res.json({
            success: true,
            orders: result.rows.map(o => ({
                ...o,
                items: JSON.parse(o.items)
            }))
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch orders' });
    }
});

// GET /api/member/stats/:wallet
router.get('/stats/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const [vouchersResult, ordersResult, referralsResult] = await Promise.all([
            pool.query(
                "SELECT COUNT(*) FROM marketplace_vouchers WHERE wallet_address = $1 AND status = 'active'",
                [wallet]
            ),
            pool.query(
                'SELECT COUNT(*) FROM marketplace_orders WHERE wallet_address = $1',
                [wallet]
            ),
            pool.query(
                'SELECT COUNT(*) FROM referrals WHERE referrer_wallet = $1',
                [wallet]
            )
        ]);

        res.json({
            success: true,
            vouchers: parseInt(vouchersResult.rows[0].count),
            orders: parseInt(ordersResult.rows[0].count),
            referrals: parseInt(referralsResult.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

module.exports = router;