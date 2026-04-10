// src/routes/packages.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// ============================================
// GET /api/packages - Public list of active packages
// ============================================
router.get('/', async (req, res) => {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        
        const result = await pool.query(`
            SELECT id, name, description, price, currency, buying_power, bonus, 
                   CASE WHEN price > 0 THEN ROUND((bonus / price) * 100) ELSE 0 END as bonus_percent,
                   tier, icon, features, popular, sort_order
            FROM membership_packages 
            WHERE active = true 
              AND ($1 = false OR test_only = false)
            ORDER BY sort_order ASC
        `, [isProduction]);

        res.json({ 
            success: true, 
            packages: result.rows.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description,
                price: parseFloat(p.price),
                currency: (p.currency || 'eur').toUpperCase(),
                buyingPower: parseFloat(p.buying_power),
                bonus: parseFloat(p.bonus),
                bonusPercent: parseInt(p.bonus_percent),
                tier: p.tier,
                icon: p.icon,
                features: p.features || [],
                popular: p.popular
            }))
        });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ success: false, error: 'Failed to load packages' });
    }
});

// ============================================
// GET /api/packages/:id - Get single package
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM membership_packages WHERE id = $1 AND active = true',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        const p = result.rows[0];
        res.json({ 
            success: true, 
            package: {
                id: p.id,
                name: p.name,
                description: p.description,
                price: parseFloat(p.price),
                currency: (p.currency || 'eur').toUpperCase(),
                buyingPower: parseFloat(p.buying_power),
                bonus: parseFloat(p.bonus),
                bonusPercent: p.price > 0 ? Math.round((p.bonus / p.price) * 100) : 0,
                tier: p.tier,
                icon: p.icon,
                features: p.features || [],
                popular: p.popular
            }
        });
    } catch (error) {
        console.error('Error fetching package:', error);
        res.status(500).json({ success: false, error: 'Failed to load package' });
    }
});

module.exports = router;