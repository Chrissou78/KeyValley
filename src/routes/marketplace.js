const express = require('express');
const router = express.Router();
const db = require('../db-postgres');

// GET all active services
router.get('/services', async (req, res) => {
    console.log('📦 GET /api/marketplace/services called');
    try {
        const result = await db.pool.query(`
            SELECT id, name, short_description, description, category, price, price_note,
                   location, image_url, features, is_active, is_featured, is_limited,
                   requires_booking, max_quantity, available_from, available_until, max_per_order
            FROM marketplace_services
            WHERE is_active = true
            ORDER BY is_featured DESC, name ASC
        `);
        console.log('✅ Found', result.rows.length, 'services');
        res.json({ success: true, services: result.rows });
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET single service by ID
router.get('/services/:id', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, name, short_description, description, category, price, price_note,
                   location, image_url, features, is_active, is_featured, is_limited,
                   requires_booking, max_quantity, available_from, available_until, max_per_order
            FROM marketplace_services
            WHERE id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Service not found' });
        }
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET services by category
router.get('/services/category/:category', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, name, short_description, description, category, price, price_note,
                   location, image_url, features, is_active, is_featured, is_limited,
                   requires_booking, max_quantity, available_from, available_until, max_per_order
            FROM marketplace_services
            WHERE is_active = true AND category = $1
            ORDER BY is_featured DESC, name ASC
        `, [req.params.category]);
        res.json({ success: true, services: result.rows });
    } catch (error) {
        console.error('Error fetching services by category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET orders by wallet
router.get('/orders/:wallet', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT * FROM marketplace_orders
            WHERE wallet_address = $1
            ORDER BY created_at DESC
        `, [req.params.wallet]);
        res.json({ success: true, orders: result.rows });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET single order by ID
router.get('/order/:id', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT * FROM marketplace_orders WHERE id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        res.json({ success: true, order: result.rows[0] });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST checkout with tokens
router.post('/checkout/tokens', async (req, res) => {
    console.log('📦 POST /api/marketplace/checkout/tokens called');
    const { wallet_address, items, email, phone } = req.body;
    
    if (!wallet_address || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    
    try {
        // Calculate total
        let totalAmount = 0;
        const serviceIds = items.map(item => item.service_id);
        
        const servicesResult = await db.pool.query(`
            SELECT id, price, name FROM marketplace_services WHERE id = ANY($1)
        `, [serviceIds]);
        
        const servicesMap = {};
        servicesResult.rows.forEach(s => { servicesMap[s.id] = s; });
        
        const orderItems = items.map(item => {
            const service = servicesMap[item.service_id];
            if (!service) throw new Error(`Service ${item.service_id} not found`);
            const itemTotal = parseFloat(service.price) * (item.quantity || 1);
            totalAmount += itemTotal;
            return {
                service_id: item.service_id,
                service_name: service.name,
                quantity: item.quantity || 1,
                price: parseFloat(service.price),
                total: itemTotal
            };
        });
        
        // Check balance
        const balanceResult = await db.pool.query(`
            SELECT balance FROM member_balances WHERE wallet_address = $1
        `, [wallet_address]);
        
        const currentBalance = balanceResult.rows.length > 0 ? parseFloat(balanceResult.rows[0].balance) : 0;
        
        if (currentBalance < totalAmount) {
            return res.status(400).json({ 
                success: false, 
                error: 'Insufficient balance',
                required: totalAmount,
                available: currentBalance
            });
        }
        
        // Create order
        const orderResult = await db.pool.query(`
            INSERT INTO marketplace_orders (wallet_address, email, phone, items, total_amount, payment_method, status)
            VALUES ($1, $2, $3, $4, $5, 'tokens', 'completed')
            RETURNING *
        `, [wallet_address, email || null, phone || null, JSON.stringify(orderItems), totalAmount]);
        
        // Deduct balance
        await db.pool.query(`
            UPDATE member_balances 
            SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW()
            WHERE wallet_address = $2
        `, [totalAmount, wallet_address]);
        
        // Log transaction
        await db.pool.query(`
            INSERT INTO token_transactions (wallet_address, amount, type, reference_type, reference_id, description, status)
            VALUES ($1, $2, 'spend', 'order', $3, $4, 'completed')
        `, [wallet_address, -totalAmount, orderResult.rows[0].id, `Marketplace purchase: ${orderItems.map(i => i.service_name).join(', ')}`]);
        
        console.log('✅ Order created:', orderResult.rows[0].id);
        res.json({ 
            success: true, 
            order: orderResult.rows[0],
            new_balance: currentBalance - totalAmount
        });
        
    } catch (error) {
        console.error('Error processing token checkout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST checkout with Stripe
router.post('/checkout/stripe', async (req, res) => {
    console.log('📦 POST /api/marketplace/checkout/stripe called');
    const { wallet_address, items, email, phone } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        // Calculate total
        let totalAmount = 0;
        const serviceIds = items.map(item => item.service_id);
        
        const servicesResult = await db.pool.query(`
            SELECT id, price, name FROM marketplace_services WHERE id = ANY($1)
        `, [serviceIds]);
        
        const servicesMap = {};
        servicesResult.rows.forEach(s => { servicesMap[s.id] = s; });
        
        const orderItems = items.map(item => {
            const service = servicesMap[item.service_id];
            if (!service) throw new Error(`Service ${item.service_id} not found`);
            const itemTotal = parseFloat(service.price) * (item.quantity || 1);
            totalAmount += itemTotal;
            return {
                service_id: item.service_id,
                service_name: service.name,
                quantity: item.quantity || 1,
                price: parseFloat(service.price),
                total: itemTotal
            };
        });
        
        // Create pending order
        const orderResult = await db.pool.query(`
            INSERT INTO marketplace_orders (wallet_address, email, phone, items, total_amount, payment_method, status)
            VALUES ($1, $2, $3, $4, $5, 'stripe', 'pending')
            RETURNING *
        `, [wallet_address || null, email || null, phone || null, JSON.stringify(orderItems), totalAmount]);
        
        // Create Stripe payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100), // cents
            currency: 'eur',
            metadata: {
                order_id: orderResult.rows[0].id,
                wallet_address: wallet_address || ''
            }
        });
        
        // Update order with payment intent ID
        await db.pool.query(`
            UPDATE marketplace_orders SET payment_intent_id = $1 WHERE id = $2
        `, [paymentIntent.id, orderResult.rows[0].id]);
        
        console.log('✅ Stripe payment intent created:', paymentIntent.id);
        res.json({ 
            success: true, 
            clientSecret: paymentIntent.client_secret,
            order_id: orderResult.rows[0].id
        });
        
    } catch (error) {
        console.error('Error creating Stripe checkout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
