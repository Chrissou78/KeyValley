// src/routes/admin/packages.js
const express = require('express');
const router = express.Router();
const db = require('../../db-postgres');

// ============================================
// GET /api/admin/packages - List all packages (including inactive)
// ============================================
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM membership_packages 
            ORDER BY sort_order ASC, created_at ASC
        `);

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
                bonusPercent: p.price > 0 ? Math.round((p.bonus / p.price) * 100) : 0,
                tier: p.tier,
                icon: p.icon,
                features: p.features || [],
                popular: p.popular,
                sortOrder: p.sort_order,
                active: p.active,
                testOnly: p.test_only,
                createdAt: p.created_at,
                updatedAt: p.updated_at
            }))
        });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ success: false, error: 'Failed to load packages' });
    }
});

// ============================================
// POST /api/admin/packages - Create new package
// ============================================
router.post('/', async (req, res) => {
    try {
        const { 
            id, name, description, price, currency, buyingPower, bonus,
            tier, icon, features, popular, sortOrder, active, testOnly 
        } = req.body;

        if (!id || !name || price === undefined || buyingPower === undefined) {
            return res.status(400).json({ success: false, error: 'Missing required fields: id, name, price, buyingPower' });
        }

        // Check if ID already exists
        const existing = await db.query('SELECT id FROM membership_packages WHERE id = $1', [id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Package ID already exists' });
        }

        const result = await db.query(`
            INSERT INTO membership_packages 
            (id, name, description, price, currency, buying_power, bonus, tier, icon, features, popular, sort_order, active, test_only)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            id, 
            name, 
            description || '', 
            price, 
            currency || 'eur', 
            buyingPower, 
            bonus || 0,
            tier || 'standard', 
            icon || 'card_membership', 
            JSON.stringify(features || []),
            popular || false, 
            sortOrder || 0, 
            active !== false, 
            testOnly || false
        ]);

        console.log(`✅ Package created: ${id}`);
        res.json({ success: true, package: result.rows[0] });
    } catch (error) {
        console.error('Error creating package:', error);
        res.status(500).json({ success: false, error: 'Failed to create package' });
    }
});

// ============================================
// PUT /api/admin/packages/:id - Update package
// ============================================
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, description, price, currency, buyingPower, bonus,
            tier, icon, features, popular, sortOrder, active, testOnly 
        } = req.body;

        const result = await db.query(`
            UPDATE membership_packages SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                price = COALESCE($3, price),
                currency = COALESCE($4, currency),
                buying_power = COALESCE($5, buying_power),
                bonus = COALESCE($6, bonus),
                tier = COALESCE($7, tier),
                icon = COALESCE($8, icon),
                features = COALESCE($9, features),
                popular = COALESCE($10, popular),
                sort_order = COALESCE($11, sort_order),
                active = COALESCE($12, active),
                test_only = COALESCE($13, test_only),
                updated_at = NOW()
            WHERE id = $14
            RETURNING *
        `, [
            name, 
            description, 
            price, 
            currency, 
            buyingPower, 
            bonus,
            tier, 
            icon, 
            features ? JSON.stringify(features) : null, 
            popular, 
            sortOrder, 
            active, 
            testOnly, 
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        console.log(`✅ Package updated: ${id}`);
        res.json({ success: true, package: result.rows[0] });
    } catch (error) {
        console.error('Error updating package:', error);
        res.status(500).json({ success: false, error: 'Failed to update package' });
    }
});

// ============================================
// DELETE /api/admin/packages/:id - Delete package
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if package has been used in purchases
        const purchasesCheck = await db.query(
            'SELECT COUNT(*) FROM membership_purchases WHERE package = $1',
            [id]
        );

        if (parseInt(purchasesCheck.rows[0].count) > 0) {
            // Soft delete - just deactivate
            await db.query(
                'UPDATE membership_packages SET active = false, updated_at = NOW() WHERE id = $1',
                [id]
            );
            console.log(`⚠️ Package deactivated (has purchases): ${id}`);
            return res.json({ success: true, softDeleted: true, message: 'Package deactivated (has existing purchases)' });
        }

        // Hard delete
        const result = await db.query('DELETE FROM membership_packages WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        console.log(`✅ Package deleted: ${id}`);
        res.json({ success: true, message: 'Package deleted' });
    } catch (error) {
        console.error('Error deleting package:', error);
        res.status(500).json({ success: false, error: 'Failed to delete package' });
    }
});

// ============================================
// POST /api/admin/packages/:id/toggle - Toggle active status
// ============================================
router.post('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(`
            UPDATE membership_packages 
            SET active = NOT active, updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, active
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        const pkg = result.rows[0];
        console.log(`✅ Package ${pkg.active ? 'activated' : 'deactivated'}: ${id}`);
        res.json({ success: true, active: pkg.active });
    } catch (error) {
        console.error('Error toggling package:', error);
        res.status(500).json({ success: false, error: 'Failed to toggle package' });
    }
});

module.exports = router;
