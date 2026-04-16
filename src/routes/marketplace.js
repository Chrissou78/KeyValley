const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const emailService = require('../services/email');
const voucherRoutes = require('./vouchers');

// GET all active services
router.get('/services', async (req, res) => {
    console.log('📦 GET /api/marketplace/services called');
    try {
        const result = await db.pool.query(`
            SELECT id, name, short_description, description, category, price, price_note,
                   location, image_url, features, is_active, is_featured, is_limited,
                   requires_booking, max_quantity, available_from, available_until, max_per_order,
                   booking_type, slot_duration_minutes, slots_per_day, available_days, 
                   booking_start_time, booking_end_time
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
                   requires_booking, max_quantity, available_from, available_until, max_per_order,
                   booking_type, slot_duration_minutes, slots_per_day, available_days,
                   booking_start_time, booking_end_time
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
                   requires_booking, max_quantity, available_from, available_until, max_per_order,
                   booking_type, slot_duration_minutes, slots_per_day, available_days,
                   booking_start_time, booking_end_time
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

// GET service availability for booking calendar
router.get('/services/:id/availability', async (req, res) => {
    console.log('📅 GET /api/marketplace/services/:id/availability called');
    try {
        const { id } = req.params;
        const { month, year } = req.query;
        
        // Get service booking settings INCLUDING fixed_duration
        const serviceResult = await db.pool.query(`
            SELECT booking_type, slot_duration_minutes, slots_per_day, 
                   available_days, booking_start_time, booking_end_time,
                   fixed_duration
            FROM marketplace_services WHERE id = $1
        `, [id]);
        
        if (serviceResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Service not found' });
        }
        
        const service = serviceResult.rows[0];
        
        // Build settings object that matches what BookingCalendar expects
        const settings = {
            booking_type: service.booking_type || 'none',
            slot_duration_minutes: service.slot_duration_minutes || 60,
            slots_per_day: service.slots_per_day || 1,
            available_days: service.available_days || '0,1,2,3,4,5,6',
            booking_start_time: service.booking_start_time || '09:00',
            booking_end_time: service.booking_end_time || '18:00',
            fixed_duration: service.fixed_duration || null
        };
        
        // If no booking required, return early
        if (!service.booking_type || service.booking_type === 'none') {
            return res.json({ 
                success: true, 
                settings,
                bookedSlots: {}
            });
        }
        
        // Get existing bookings for the month
        let bookedSlots = {};
        
        try {
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
            
            const bookingsResult = await db.pool.query(`
                SELECT booking_date, time_slot, COUNT(*) as booked_count
                FROM service_bookings
                WHERE service_id = $1 
                  AND booking_date BETWEEN $2 AND $3
                  AND status != 'cancelled'
                GROUP BY booking_date, time_slot
            `, [id, startDate, endDate]);
            
            bookingsResult.rows.forEach(row => {
                const dateKey = row.booking_date.toISOString().split('T')[0];
                bookedSlots[dateKey] = (bookedSlots[dateKey] || 0) + parseInt(row.booked_count);
                
                if (row.time_slot && row.time_slot !== 'full_day') {
                    const slotKey = dateKey + '_slots';
                    if (!bookedSlots[slotKey]) bookedSlots[slotKey] = [];
                    bookedSlots[slotKey].push(row.time_slot);
                }
            });
        } catch (e) {
            console.log('Note: service_bookings query error (table may not exist):', e.message);
        }
        
        console.log('✅ Returning availability for service', id, '- settings:', settings);
        res.json({
            success: true,
            settings,
            bookedSlots
        });
        
    } catch (error) {
        console.error('Availability error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST create a booking
router.post('/services/:id/book', async (req, res) => {
    console.log('📅 POST /api/marketplace/services/:id/book called');
    try {
        const { id } = req.params;
        const { wallet_address, email, booking_date, time_slot, order_id } = req.body;
        
        // Check if slot is still available
        const existing = await db.pool.query(`
            SELECT COUNT(*) as count FROM service_bookings
            WHERE service_id = $1 AND booking_date = $2 AND time_slot = $3 AND status != 'cancelled'
        `, [id, booking_date, time_slot || 'full_day']);
        
        const service = await db.pool.query(
            'SELECT slots_per_day FROM marketplace_services WHERE id = $1',
            [id]
        );
        
        const maxSlots = service.rows[0]?.slots_per_day || 1;
        
        if (parseInt(existing.rows[0].count) >= maxSlots) {
            return res.status(400).json({ success: false, error: 'This slot is no longer available' });
        }
        
        // Create booking
        const result = await db.pool.query(`
            INSERT INTO service_bookings (service_id, wallet_address, email, booking_date, time_slot, order_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
            RETURNING *
        `, [id, wallet_address, email, booking_date, time_slot || 'full_day', order_id]);
        
        console.log('✅ Booking created:', result.rows[0].id);
        res.json({ success: true, booking: result.rows[0] });
        
    } catch (error) {
        console.error('Booking error:', error);
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

// POST checkout with tokens (Kea€)
router.post('/checkout/tokens', async (req, res) => {
    console.log('📦 POST /api/marketplace/checkout/tokens called');
    const { wallet_address, items, email, phone, name } = req.body;
    
    if (!wallet_address || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    
    try {
        // Calculate total
        let totalAmount = 0;
        const serviceIds = items.map(item => item.service_id || item.serviceId);
        
        const servicesResult = await db.pool.query(`
            SELECT id, price, name FROM marketplace_services WHERE id = ANY($1)
        `, [serviceIds]);
        
        const servicesMap = {};
        servicesResult.rows.forEach(s => { servicesMap[s.id] = s; });
        
        const orderItems = items.map(item => {
            const serviceId = item.service_id || item.serviceId;
            const service = servicesMap[serviceId];
            if (!service) throw new Error(`Service ${serviceId} not found`);
            
            // Use totalPrice from options if available (for bookings with nights)
            const itemTotal = item.options?.totalPrice || (parseFloat(service.price) * (item.quantity || 1));
            totalAmount += itemTotal;
            
            return {
                service_id: serviceId,
                service_name: service.name,
                quantity: item.quantity || 1,
                price: parseFloat(service.price),
                total: itemTotal,
                booking_start: item.options?.bookingStart || null,
                booking_end: item.options?.bookingEnd || null,
                nights: item.options?.nights || null,
                booking_date: item.options?.bookingDate || null,
                time_slot: item.options?.timeSlot || null
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
                error: 'Insufficient Kea€ balance',
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
        
        const orderId = orderResult.rows[0].id;
        
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
        `, [wallet_address, -totalAmount, orderId, `Marketplace purchase: ${orderItems.map(i => i.service_name).join(', ')}`]);
        
        // Create vouchers for each item
        const createdVouchers = [];
        
        for (const item of orderItems) {
            const voucherCode = voucherRoutes.generateVoucherCode();
            
            const voucherResult = await db.pool.query(`
                INSERT INTO marketplace_vouchers (
                    order_id, wallet_address, user_email, service_id, service_name, 
                    code, value, status, valid_from, created_at,
                    booking_start, booking_end, booking_date
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', CURRENT_DATE, NOW(), $8, $9, $10)
                RETURNING *
            `, [
                orderId,
                wallet_address,
                email || null,
                item.service_id,
                item.service_name,
                voucherCode,
                item.total,
                item.booking_start || null,
                item.booking_end || null,
                item.booking_date || null
            ]);
            
            const voucher = voucherResult.rows[0];
            createdVouchers.push(voucher);
            
            // Send email to buyer
            if (email) {
                try {
                    const buyerEmailResult = await emailService.sendVoucherPurchaseEmail(voucher, email);
                    await emailService.logEmail(
                        db, 
                        voucher.id, 
                        'purchase_buyer', 
                        email,
                        `Your Kea Valley Voucher - ${voucher.service_name}`,
                        buyerEmailResult.success ? 'sent' : 'failed',
                        buyerEmailResult.error || null
                    );
                } catch (emailErr) {
                    console.error('Failed to send buyer email:', emailErr.message);
                }
            }
            
            // Send notification to site owner
            try {
                const ownerEmailResult = await emailService.sendVoucherPurchaseNotificationToOwner(voucher, email, name);
                await emailService.logEmail(
                    db, 
                    voucher.id, 
                    'purchase_owner', 
                    emailService.SITE_OWNER_EMAIL,
                    `New Voucher Purchase - ${voucher.service_name}`,
                    ownerEmailResult.success ? 'sent' : 'failed',
                    ownerEmailResult.error || null
                );
            } catch (emailErr) {
                console.error('Failed to send owner notification:', emailErr.message);
            }
        }
        
        console.log('✅ Order created with', createdVouchers.length, 'voucher(s):', orderId);
        
        res.json({ 
            success: true, 
            order: orderResult.rows[0],
            orderId: orderId,
            vouchers: createdVouchers,
            new_balance: currentBalance - totalAmount
        });
        
    } catch (error) {
        console.error('Error processing token checkout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST checkout with Stripe - create intent
router.post('/checkout/create-intent', async (req, res) => {
    console.log('📦 POST /api/marketplace/checkout/create-intent called');
    const { wallet_address, items, email, phone, notes, name } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        // Calculate total
        let totalAmount = 0;
        const serviceIds = items.map(item => item.service_id || item.serviceId);
        
        const servicesResult = await db.pool.query(`
            SELECT id, price, name FROM marketplace_services WHERE id = ANY($1)
        `, [serviceIds]);
        
        const servicesMap = {};
        servicesResult.rows.forEach(s => { servicesMap[s.id] = s; });
        
        const orderItems = items.map(item => {
            const serviceId = item.service_id || item.serviceId;
            const service = servicesMap[serviceId];
            if (!service) throw new Error(`Service ${serviceId} not found`);
            
            const itemTotal = item.options?.totalPrice || (parseFloat(service.price) * (item.quantity || 1));
            totalAmount += itemTotal;
            
            return {
                service_id: serviceId,
                service_name: service.name,
                quantity: item.quantity || 1,
                price: parseFloat(service.price),
                total: itemTotal,
                booking_start: item.options?.bookingStart || null,
                booking_end: item.options?.bookingEnd || null,
                nights: item.options?.nights || null,
                booking_date: item.options?.bookingDate || null,
                time_slot: item.options?.timeSlot || null
            };
        });
        
        // Create pending order
        const orderResult = await db.pool.query(`
            INSERT INTO marketplace_orders (wallet_address, email, phone, items, total_amount, payment_method, status, notes)
            VALUES ($1, $2, $3, $4, $5, 'stripe', 'pending', $6)
            RETURNING *
        `, [wallet_address || null, email || null, phone || null, JSON.stringify(orderItems), totalAmount, notes || null]);
        
        // Create Stripe payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100), // cents
            currency: 'eur',
            metadata: {
                order_id: orderResult.rows[0].id,
                wallet_address: wallet_address || '',
                email: email || '',
                name: name || ''
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
            orderId: orderResult.rows[0].id
        });
        
    } catch (error) {
        console.error('Error creating Stripe checkout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST checkout with Stripe (legacy endpoint)
router.post('/checkout/stripe', async (req, res) => {
    req.url = '/checkout/create-intent';
    return router.handle(req, res);
});

module.exports = router;
