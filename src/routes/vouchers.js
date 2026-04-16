const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const crypto = require('crypto');
const emailService = require('../services/email');

// Generate voucher code: KEA-XXXX-XXXX
function generateVoucherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'KEA-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Generate validation token
function generateValidationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// GET vouchers by wallet
router.get('/:wallet', async (req, res) => {
    console.log('🎫 GET /api/vouchers/:wallet called');
    try {
        const result = await db.pool.query(`
            SELECT v.*, s.image_url, s.category, s.description as service_description
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE v.wallet_address = $1
            ORDER BY v.created_at DESC
        `, [req.params.wallet]);
        
        res.json({ success: true, vouchers: result.rows });
    } catch (error) {
        console.error('Error fetching vouchers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET voucher by code
router.get('/code/:code', async (req, res) => {
    console.log('🎫 GET /api/vouchers/code/:code called');
    try {
        const result = await db.pool.query(`
            SELECT v.*, s.image_url, s.category, s.description as service_description
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE v.code = $1
        `, [req.params.code.toUpperCase()]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        res.json({ success: true, voucher: result.rows[0] });
    } catch (error) {
        console.error('Error fetching voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET voucher by ID
router.get('/id/:id', async (req, res) => {
    console.log('🎫 GET /api/vouchers/id/:id called');
    try {
        const result = await db.pool.query(`
            SELECT v.*, s.image_url, s.category, s.description as service_description
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE v.id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        res.json({ success: true, voucher: result.rows[0] });
    } catch (error) {
        console.error('Error fetching voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST request booking for a voucher
router.post('/:id/book', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/book called');
    const { booking_date, booking_start, booking_end, booking_notes } = req.body;
    
    try {
        // Get voucher
        const voucherResult = await db.pool.query(
            'SELECT * FROM marketplace_vouchers WHERE id = $1',
            [req.params.id]
        );
        
        if (voucherResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        const voucher = voucherResult.rows[0];
        
        if (voucher.status !== 'active' && voucher.status !== 'purchased') {
            return res.status(400).json({ 
                success: false, 
                error: `Cannot book voucher with status: ${voucher.status}` 
            });
        }
        
        // Generate validation token for email link
        const validationToken = generateValidationToken();
        
        // Update voucher with booking request
        await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET booking_date = $1, 
                booking_start = $2, 
                booking_end = $3, 
                booking_notes = $4,
                booking_requested_at = NOW(),
                status = 'pending_validation',
                validation_token = $5
            WHERE id = $6
        `, [booking_date, booking_start, booking_end, booking_notes, validationToken, req.params.id]);
        
        // Send email to site owner with validation link
        const bookingDetails = { booking_date, booking_start, booking_end, booking_notes };
        const emailResult = await emailService.sendBookingRequestEmail(voucher, bookingDetails, validationToken);
        
        // Log email
        await emailService.logEmail(
            db,
            voucher.id,
            'booking_request',
            emailService.SITE_OWNER_EMAIL,
            `Booking Request - ${voucher.service_name}`,
            emailResult.success ? 'sent' : 'failed',
            emailResult.error || null
        );
        
        console.log('✅ Booking requested for voucher:', voucher.code);
        res.json({ 
            success: true, 
            message: 'Booking request submitted. You will receive a confirmation email once validated.',
            voucher_code: voucher.code
        });
        
    } catch (error) {
        console.error('Error requesting booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET validate voucher via email link (one-click)
router.get('/validate/:token', async (req, res) => {
    console.log('🎫 GET /api/vouchers/validate/:token called');
    try {
        const result = await db.pool.query(
            'SELECT * FROM marketplace_vouchers WHERE validation_token = $1',
            [req.params.token]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).send(`
                <html>
                <head><title>Invalid Link</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0d0d0d; color: #fff;">
                    <h1 style="color: #ef4444;">Invalid or Expired Link</h1>
                    <p style="color: #94a3b8;">This validation link is no longer valid.</p>
                    <a href="/" style="color: #daa520;">Return to Home</a>
                </body>
                </html>
            `);
        }
        
        const voucher = result.rows[0];
        
        if (voucher.status === 'validated' || voucher.status === 'consumed') {
            return res.send(`
                <html>
                <head><title>Already Validated</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0d0d0d; color: #fff;">
                    <h1 style="color: #10b981;">Already Validated</h1>
                    <p style="color: #94a3b8;">This voucher has already been validated.</p>
                    <p style="color: #daa520; font-size: 24px; font-weight: bold;">${voucher.code}</p>
                    <a href="/admin" style="display: inline-block; background: #daa520; color: #0d0d0d; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 20px;">Go to Admin</a>
                </body>
                </html>
            `);
        }
        
        // Validate the voucher
        await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'validated',
                validated_at = NOW(),
                validated_by = 'email_link'
            WHERE id = $1
        `, [voucher.id]);
        
        // Send confirmation email to buyer
        if (voucher.user_email) {
            const emailResult = await emailService.sendBookingConfirmedEmail(voucher);
            await emailService.logEmail(
                db,
                voucher.id,
                'booking_confirmed',
                voucher.user_email,
                `Booking Confirmed - ${voucher.service_name}`,
                emailResult.success ? 'sent' : 'failed',
                emailResult.error || null
            );
        }
        
        console.log('✅ Voucher validated via email link:', voucher.code);
        
        // Format dates for display
        const dateDisplay = voucher.booking_start && voucher.booking_end
            ? `${voucher.booking_start} to ${voucher.booking_end}`
            : voucher.booking_date || 'As confirmed';
        
        res.send(`
            <html>
            <head>
                <title>Booking Confirmed</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
                <style>
                    body { 
                        font-family: 'Manrope', sans-serif; 
                        background: #0d0d0d; 
                        color: #fff; 
                        text-align: center; 
                        padding: 50px 20px;
                        margin: 0;
                    }
                    .container { 
                        max-width: 500px; 
                        margin: 0 auto; 
                        background: #1a1a1a; 
                        padding: 40px; 
                        border-radius: 16px; 
                        border: 1px solid rgba(218,165,32,0.2); 
                    }
                    .success-icon {
                        width: 80px;
                        height: 80px;
                        background: rgba(16, 185, 129, 0.2);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto 20px;
                        font-size: 40px;
                    }
                    h1 { 
                        color: #10b981; 
                        margin: 0 0 10px;
                        font-size: 28px;
                    }
                    .subtitle {
                        color: #94a3b8;
                        margin-bottom: 30px;
                    }
                    .code { 
                        font-size: 28px; 
                        font-weight: bold; 
                        color: #daa520; 
                        background: rgba(218,165,32,0.1); 
                        padding: 20px; 
                        border-radius: 12px; 
                        margin: 20px 0;
                        letter-spacing: 2px;
                    }
                    .details { 
                        text-align: left; 
                        margin: 25px 0;
                        background: #0d0d0d;
                        border-radius: 12px;
                        padding: 20px;
                    }
                    .details-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 12px 0;
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                    }
                    .details-row:last-child {
                        border-bottom: none;
                    }
                    .details-label { 
                        color: #94a3b8; 
                    }
                    .details-value {
                        color: #fff;
                        font-weight: 600;
                    }
                    .notification {
                        background: rgba(16, 185, 129, 0.1);
                        border: 1px solid rgba(16, 185, 129, 0.3);
                        border-radius: 8px;
                        padding: 15px;
                        margin: 20px 0;
                        color: #10b981;
                        font-size: 14px;
                    }
                    .btn { 
                        display: inline-block; 
                        background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); 
                        color: #0d0d0d; 
                        padding: 15px 35px; 
                        border-radius: 8px; 
                        text-decoration: none; 
                        font-weight: bold; 
                        margin-top: 20px;
                        transition: transform 0.2s;
                    }
                    .btn:hover {
                        transform: translateY(-2px);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">✓</div>
                    <h1>Booking Confirmed!</h1>
                    <p class="subtitle">The voucher has been validated successfully</p>
                    
                    <div class="code">${voucher.code}</div>
                    
                    <div class="details">
                        <div class="details-row">
                            <span class="details-label">Service</span>
                            <span class="details-value">${voucher.service_name}</span>
                        </div>
                        <div class="details-row">
                            <span class="details-label">Date</span>
                            <span class="details-value">${dateDisplay}</span>
                        </div>
                        <div class="details-row">
                            <span class="details-label">Value</span>
                            <span class="details-value" style="color: #daa520;">Kea€${voucher.value}</span>
                        </div>
                        <div class="details-row">
                            <span class="details-label">Member</span>
                            <span class="details-value">${voucher.user_email || voucher.wallet_address.slice(0, 10) + '...'}</span>
                        </div>
                    </div>
                    
                    <div class="notification">
                        ✉️ A confirmation email has been sent to the member.
                    </div>
                    
                    <a href="/admin" class="btn">Go to Admin Dashboard</a>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error validating voucher:', error);
        res.status(500).send(`
            <html>
            <head><title>Error</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0d0d0d; color: #fff;">
                <h1 style="color: #ef4444;">Error</h1>
                <p style="color: #94a3b8;">Something went wrong while validating the voucher.</p>
                <p style="color: #64748b; font-size: 12px;">${error.message}</p>
                <a href="/admin" style="color: #daa520;">Go to Admin</a>
            </body>
            </html>
        `);
    }
});

// POST validate voucher (admin)
router.post('/:id/validate', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/validate called');
    const { validated_by } = req.body;
    
    try {
        const result = await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'validated',
                validated_at = NOW(),
                validated_by = $1
            WHERE id = $2
            RETURNING *
        `, [validated_by || 'admin', req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        const voucher = result.rows[0];
        
        // Send confirmation email to buyer
        if (voucher.user_email) {
            const emailResult = await emailService.sendBookingConfirmedEmail(voucher);
            await emailService.logEmail(
                db,
                voucher.id,
                'booking_confirmed',
                voucher.user_email,
                `Booking Confirmed - ${voucher.service_name}`,
                emailResult.success ? 'sent' : 'failed',
                emailResult.error || null
            );
        }
        
        console.log('✅ Voucher validated:', voucher.code);
        res.json({ success: true, voucher: voucher });
        
    } catch (error) {
        console.error('Error validating voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST consume voucher (admin - marks as used)
router.post('/:id/consume', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/consume called');
    
    try {
        const result = await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'consumed',
                redeemed_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        console.log('✅ Voucher consumed:', result.rows[0].code);
        res.json({ success: true, voucher: result.rows[0] });
        
    } catch (error) {
        console.error('Error consuming voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST cancel voucher (admin)
router.post('/:id/cancel', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/cancel called');
    
    try {
        const result = await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'cancelled'
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        console.log('✅ Voucher cancelled:', result.rows[0].code);
        res.json({ success: true, voucher: result.rows[0] });
        
    } catch (error) {
        console.error('Error cancelling voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export helper functions for use in marketplace checkout
router.generateVoucherCode = generateVoucherCode;
router.generateValidationToken = generateValidationToken;

module.exports = router;
