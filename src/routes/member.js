// src/routes/member.js
const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const { ethers } = require('ethers');

// GET /api/member/balance/:wallet
router.get('/balance/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        
        // Get on-chain balance (source of truth)
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
        const contract = new ethers.Contract(
            process.env.KEA_CONTRACT_ADDRESS,
            ['function balanceOf(address account) view returns (uint256)'],
            provider
        );
        
        const onChainRaw = await contract.balanceOf(wallet);
        const onChainBalance = Number(ethers.formatUnits(onChainRaw, 18));
        
        // Get DB record
        const result = await db.pool.query(
            'SELECT balance, total_credited, total_spent FROM member_balances WHERE wallet_address = $1',
            [wallet]
        );
        
        // Sync DB in background if different
        if (result.rows.length > 0) {
            const dbBalance = parseFloat(result.rows[0].balance) || 0;
            if (Math.abs(onChainBalance - dbBalance) > 0.001) {
                db.pool.query(
                    'UPDATE member_balances SET balance = $1, updated_at = NOW() WHERE wallet_address = $2',
                    [onChainBalance, wallet]
                ).catch(err => console.error('Balance sync error:', err));
            }
        }
        
        res.json({ 
            success: true, 
            balance: onChainBalance,
            total_credited: result.rows.length > 0 ? parseFloat(result.rows[0].total_credited) || 0 : 0,
            total_spent: result.rows.length > 0 ? parseFloat(result.rows[0].total_spent) || 0 : 0
        });
        
    } catch (error) {
        console.error('Error fetching balance:', error);
        
        // Fallback to DB if on-chain fails
        try {
            const result = await db.pool.query(
                'SELECT balance, total_credited, total_spent FROM member_balances WHERE wallet_address = $1',
                [req.params.wallet.toLowerCase()]
            );
            
            res.json({ 
                success: true, 
                balance: result.rows.length > 0 ? parseFloat(result.rows[0].balance) || 0 : 0,
                total_credited: result.rows.length > 0 ? parseFloat(result.rows[0].total_credited) || 0 : 0,
                total_spent: result.rows.length > 0 ? parseFloat(result.rows[0].total_spent) || 0 : 0
            });
        } catch (dbErr) {
            res.status(500).json({ success: false, error: 'Failed to fetch balance' });
        }
    }
});


// GET /api/member/vouchers/:wallet
router.get('/vouchers/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        
        const result = await db.pool.query(`
            SELECT 
                v.id, v.code, v.service_name, v.value, 
                v.valid_from, v.valid_until, v.status, v.redeemed_at,
                s.image_url, s.category
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE LOWER(v.wallet_address) = $1
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
        const wallet = req.params.wallet.toLowerCase();
        
        const result = await db.pool.query(`
            SELECT 
                id, order_number, items, total_amount, 
                payment_method, status, created_at
            FROM marketplace_orders
            WHERE LOWER(wallet_address) = $1
            ORDER BY created_at DESC
        `, [wallet]);

        res.json({
            success: true,
            orders: result.rows.map(o => ({
                ...o,
                items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
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
            db.pool.query(
                "SELECT COUNT(*) FROM marketplace_vouchers WHERE LOWER(wallet_address) = LOWER($1) AND status = 'active'",
                [wallet]
            ),
            db.pool.query(
                'SELECT COUNT(*) FROM marketplace_orders WHERE LOWER(wallet_address) = LOWER($1)',
                [wallet]
            ),
            db.pool.query(
                'SELECT COUNT(*) FROM referrals WHERE LOWER(referrer_wallet) = LOWER($1)',
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
