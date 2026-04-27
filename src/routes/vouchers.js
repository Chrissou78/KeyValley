// src/routes/vouchers.js
// VERSION: 2026-04-25 - Voucher booking system with WalletTwo email webhook

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const crypto = require('crypto');

// ============================================
// EMAIL CONFIGURATION
// ============================================
const WALLETTWO_EMAIL_WEBHOOK = process.env.WALLETTWO_EMAIL_WEBHOOK;
const SITE_OWNER_EMAIL = process.env.SITE_OWNER_EMAIL || 'julie.meyer@vivapartners.net';
const SITE_URL = process.env.SITE_URL || 'https://keavalley.com';

// ============================================
// EMAIL FUNCTIONS
// ============================================

async function sendEmail(email, htmlContent) {
    if (!WALLETTWO_EMAIL_WEBHOOK) {
        console.error('❌ WALLETTWO_EMAIL_WEBHOOK not configured');
        return { success: false, error: 'Email webhook not configured' };
    }
    
    try {
        const response = await fetch(WALLETTWO_EMAIL_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                content: htmlContent
            })
        });
        
        if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}`);
        }
        
        console.log('✅ Email sent via webhook to:', email);
        return { success: true };
    } catch (error) {
        console.error('❌ Email webhook failed:', error.message);
        return { success: false, error: error.message };
    }
}

function getBaseTemplate(content) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin: 0; padding: 0; background-color: #0d0d0d; font-family: Helvetica Neue, Arial, sans-serif;"><div style="max-width: 600px; margin: 0 auto; background-color: #1a1a1a;"><div style="background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); padding: 20px; text-align: center;"><img src="${SITE_URL}/images/logo.png" alt="Kea Valley" height="30" style="height: 30px; width: auto;"><p style="color: #ffffff; margin: 10px 0 0; font-size: 14px; font-weight: 600;">Kea Valley Private Members Club</p></div><div style="padding: 40px 30px; color: #ffffff;">${content}</div><div style="background: #0d0d0d; padding: 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);"><p style="color: #64748b; font-size: 12px; margin: 5px 0;">Kea Valley Private Members Club</p><p style="color: #64748b; font-size: 12px; margin: 5px 0;">Questions? Contact us at <a href="mailto:${SITE_OWNER_EMAIL}" style="color: #daa520; text-decoration: none;">${SITE_OWNER_EMAIL}</a></p><p style="color: #64748b; font-size: 12px; margin: 15px 0 0;">2026 Kea Valley. All rights reserved.</p></div></div></body></html>`;
}

async function sendBookingRequestToOwner(voucher, booking_date, booking_start, booking_end, booking_notes) {
    // Format the date properly
    let dateDisplay = booking_date || 'Not specified';
    if (booking_date) {
        try {
            const dateObj = new Date(booking_date);
            dateDisplay = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) {
            dateDisplay = booking_date;
        }
    }
    
    // Add time if provided
    if (booking_start && booking_end) {
        dateDisplay += ` (${booking_start} - ${booking_end})`;
    } else if (booking_start) {
        dateDisplay += ` at ${booking_start}`;
    }

    const confirmUrl = `${SITE_URL}/api/vouchers/validate/${voucher.validation_token}`;
    const rejectUrl = `${SITE_URL}/api/vouchers/reject/${voucher.validation_token}`;

    const content = `<h2 style="color: #ffffff; margin-top: 0;">New Booking Request</h2><p style="color: #94a3b8; line-height: 1.6;">A member has requested a booking.</p><div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Voucher Code</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.code}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.service_name}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Requested Date</td><td style="color: #daa520; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${dateDisplay}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Value</td><td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${voucher.value}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0;">Member Email</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${voucher.user_email || 'N/A'}</td></tr>${booking_notes ? `<tr><td style="color: #94a3b8; padding: 10px 0;">Notes</td><td style="color: #ffffff; padding: 10px 0; text-align: right;">${booking_notes}</td></tr>` : ''}</table></div><div style="text-align: center; margin: 30px 0;"><a href="${confirmUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 5px;">Confirm Booking</a><a href="${rejectUrl}" style="display: inline-block; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 5px;">Reject Booking</a></div>`;

    return sendEmail(SITE_OWNER_EMAIL, getBaseTemplate(content));
}

async function sendBookingRequestToUser(voucher, booking_date, booking_start, booking_end) {
    // Format the date properly
    let dateDisplay = booking_date || 'Not specified';
    if (booking_date) {
        try {
            const dateObj = new Date(booking_date);
            dateDisplay = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) {
            dateDisplay = booking_date;
        }
    }
    
    // Add time if provided
    if (booking_start && booking_end) {
        dateDisplay += ` (${booking_start} - ${booking_end})`;
    } else if (booking_start) {
        dateDisplay += ` at ${booking_start}`;
    }

    const content = `<h2 style="color: #ffffff; margin-top: 0;">Booking Request Submitted</h2><p style="color: #94a3b8; line-height: 1.6;">Your booking request has been submitted and is pending confirmation.</p><div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Voucher Code</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.code}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.service_name}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Requested Date</td><td style="color: #daa520; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${dateDisplay}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0;">Status</td><td style="color: #f59e0b; font-weight: 600; padding: 10px 0; text-align: right;">Pending Confirmation</td></tr></table></div><p style="color: #94a3b8; line-height: 1.6;">You will receive an email once your booking is confirmed or if we need to arrange an alternative time.</p><div style="text-align: center; margin: 30px 0;"><a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View My Vouchers</a></div>`;

    return sendEmail(voucher.user_email, getBaseTemplate(content));
}

async function sendBookingConfirmedToUser(voucher) {
    // Format the date properly
    let dateDisplay = 'As confirmed';
    if (voucher.booking_date) {
        try {
            const dateObj = new Date(voucher.booking_date);
            dateDisplay = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) {
            dateDisplay = voucher.booking_date;
        }
    }
    
    // Add time if provided (check both new and old column names)
    const startTime = voucher.booking_time_start || voucher.booking_start;
    const endTime = voucher.booking_time_end || voucher.booking_end;
    
    if (startTime && endTime && !startTime.includes('-')) {
        dateDisplay += ` (${startTime} - ${endTime})`;
    } else if (startTime && !startTime.includes('-')) {
        dateDisplay += ` at ${startTime}`;
    }

    const content = `<h2 style="color: #ffffff; margin-top: 0;">Booking Confirmed!</h2><p style="color: #94a3b8; line-height: 1.6;">Great news! Your booking has been confirmed.</p><div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;"><p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR BOOKING DATE</p><span style="font-size: 24px; font-weight: bold; color: #10b981;">${dateDisplay}</span></div><div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.service_name}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Voucher Code</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.code}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0;">Status</td><td style="color: #10b981; font-weight: 600; padding: 10px 0; text-align: right;">Confirmed</td></tr></table></div><p style="color: #94a3b8; line-height: 1.6;">Please arrive on time. If you need to make changes, contact us.</p><div style="text-align: center; margin: 30px 0;"><a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View My Bookings</a></div>`;

    return sendEmail(voucher.user_email, getBaseTemplate(content));
}

async function sendBookingRejectedToUser(voucher, reason) {
    // Format the date properly
    let dateDisplay = 'the requested date';
    if (voucher.booking_date) {
        try {
            const dateObj = new Date(voucher.booking_date);
            dateDisplay = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) {
            dateDisplay = voucher.booking_date;
        }
    }
    
    // Add time if provided
    const startTime = voucher.booking_time_start || voucher.booking_start;
    if (startTime && !startTime.includes('-')) {
        dateDisplay += ` at ${startTime}`;
    }

    const content = `<h2 style="color: #ffffff; margin-top: 0;">Booking Update Required</h2><p style="color: #94a3b8; line-height: 1.6;">Unfortunately, we were unable to confirm your booking for ${dateDisplay}.</p>${reason ? `<div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 20px; margin: 25px 0;"><p style="color: #ef4444; margin: 0;"><strong>Reason:</strong> ${reason}</p></div>` : ''}<div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.service_name}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Voucher Code</td><td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${voucher.code}</td></tr><tr><td style="color: #94a3b8; padding: 10px 0;">Voucher Status</td><td style="color: #10b981; font-weight: 600; padding: 10px 0; text-align: right;">Still Valid</td></tr></table></div><p style="color: #94a3b8; line-height: 1.6;">Your voucher is still valid. Please request a new booking date.</p><div style="text-align: center; margin: 30px 0;"><a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Request New Date</a></div>`;

    return sendEmail(voucher.user_email, getBaseTemplate(content));
}

// ============================================
// HELPER FUNCTIONS
// ============================================

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

// ============================================
// ROUTES
// ============================================

// GET validate voucher via email link (one-click confirm)
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
                validated_by = 'email_link',
                validation_token = NULL
            WHERE id = $1
        `, [voucher.id]);
        
        // Send confirmation email to buyer
        if (voucher.user_email) {
            await sendBookingConfirmedToUser(voucher);
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
                    body { font-family: 'Manrope', sans-serif; background: #0d0d0d; color: #fff; text-align: center; padding: 50px 20px; margin: 0; }
                    .container { max-width: 500px; margin: 0 auto; background: #1a1a1a; padding: 40px; border-radius: 16px; border: 1px solid rgba(218,165,32,0.2); }
                    .success-icon { width: 80px; height: 80px; background: rgba(16, 185, 129, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 40px; }
                    h1 { color: #10b981; margin: 0 0 10px; font-size: 28px; }
                    .subtitle { color: #94a3b8; margin-bottom: 30px; }
                    .code { font-size: 28px; font-weight: bold; color: #daa520; background: rgba(218,165,32,0.1); padding: 20px; border-radius: 12px; margin: 20px 0; letter-spacing: 2px; }
                    .details { text-align: left; margin: 25px 0; background: #0d0d0d; border-radius: 12px; padding: 20px; }
                    .details-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
                    .details-row:last-child { border-bottom: none; }
                    .details-label { color: #94a3b8; }
                    .details-value { color: #fff; font-weight: 600; }
                    .notification { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 15px; margin: 20px 0; color: #10b981; font-size: 14px; }
                    .btn { display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 20px; }
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
                    <div class="notification">✉️ A confirmation email has been sent to the member.</div>
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

// GET reject voucher via email link (one-click decline)
router.get('/reject/:token', async (req, res) => {
    console.log('🎫 GET /api/vouchers/reject/:token called');
    const reason = req.query.reason || 'Date not available';
    
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
                    <p style="color: #94a3b8;">This link is no longer valid.</p>
                    <a href="/admin" style="color: #daa520;">Go to Admin</a>
                </body>
                </html>
            `);
        }
        
        const voucher = result.rows[0];
        
        if (voucher.status !== 'pending_validation') {
            return res.send(`
                <html>
                <head><title>Already Processed</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0d0d0d; color: #fff;">
                    <h1 style="color: #f59e0b;">Already Processed</h1>
                    <p style="color: #94a3b8;">This booking request has already been processed.</p>
                    <p style="color: #daa520;">Status: ${voucher.status}</p>
                    <a href="/admin" style="display: inline-block; background: #daa520; color: #0d0d0d; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 20px;">Go to Admin</a>
                </body>
                </html>
            `);
        }
        
        // Reset voucher to active (booking rejected, voucher still valid)
        await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'active',
                booking_date = NULL,
                booking_start = NULL,
                booking_end = NULL,
                booking_notes = NULL,
                booking_requested_at = NULL,
                validation_token = NULL
            WHERE id = $1
        `, [voucher.id]);
        
        // Send rejection email to buyer
        if (voucher.user_email) {
            await sendBookingRejectedToUser(voucher, reason);
        }
        
        console.log('❌ Booking rejected for voucher:', voucher.code, 'Reason:', reason);
        
        res.send(`
            <html>
            <head>
                <title>Booking Declined</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Manrope', sans-serif; background: #0d0d0d; color: #fff; text-align: center; padding: 50px 20px; margin: 0; }
                    .container { max-width: 500px; margin: 0 auto; background: #1a1a1a; padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
                    .icon { width: 80px; height: 80px; background: rgba(245, 158, 11, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 40px; }
                    h1 { color: #f59e0b; margin: 0 0 10px; font-size: 28px; }
                    .subtitle { color: #94a3b8; margin-bottom: 30px; }
                    .code { font-size: 20px; color: #daa520; background: rgba(218,165,32,0.1); padding: 15px; border-radius: 12px; margin: 20px 0; }
                    .info { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 15px; margin: 20px 0; color: #10b981; font-size: 14px; text-align: left; }
                    .btn { display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">✕</div>
                    <h1>Booking Declined</h1>
                    <p class="subtitle">The booking request has been declined</p>
                    <div class="code">
                        <strong>${voucher.service_name}</strong><br>
                        <span style="color: #94a3b8; font-size: 14px;">Voucher: ${voucher.code}</span>
                    </div>
                    <div class="info">
                        ✓ The voucher is still valid<br>
                        ✓ The member has been notified<br>
                        ✓ They can request a different date
                    </div>
                    <a href="/admin" class="btn">Go to Admin Dashboard</a>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error rejecting booking:', error);
        res.status(500).send(`
            <html>
            <head><title>Error</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0d0d0d; color: #fff;">
                <h1 style="color: #ef4444;">Error</h1>
                <p style="color: #94a3b8;">Something went wrong.</p>
                <a href="/admin" style="color: #daa520;">Go to Admin</a>
            </body>
            </html>
        `);
    }
});

// GET vouchers by wallet
router.get('/:wallet', async (req, res) => {
    console.log('🎫 GET /api/vouchers/:wallet called');
    try {
        const result = await db.pool.query(`
            SELECT v.*, s.image_url, s.category, s.description as service_description
            FROM marketplace_vouchers v
            LEFT JOIN marketplace_services s ON v.service_id = s.id
            WHERE LOWER(v.wallet_address) = LOWER($1)
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
        
        // Determine if booking_start/end are dates (accommodation) or times (service)
        // If format is "HH:MM" it's a time, if "YYYY-MM-DD" it's a date
        const isTimeFormat = (val) => val && /^\d{2}:\d{2}$/.test(val);
        const isDateFormat = (val) => val && /^\d{4}-\d{2}-\d{2}$/.test(val);
        
        let updateQuery, updateParams;
        
        if (isTimeFormat(booking_start) || isTimeFormat(booking_end)) {
            // Service booking: single date + time slots
            const startTime = booking_start && booking_start.trim() ? booking_start : null;
            const endTime = booking_end && booking_end.trim() ? booking_end : null;
            
            updateQuery = `
                UPDATE marketplace_vouchers 
                SET booking_date = $1, 
                    booking_time_start = $2, 
                    booking_time_end = $3, 
                    booking_notes = $4,
                    booking_requested_at = NOW(),
                    status = 'pending_validation',
                    validation_token = $5
                WHERE id = $6
            `;
            updateParams = [booking_date, startTime, endTime, booking_notes || null, validationToken, req.params.id];
        } else {
            // Accommodation booking: date range (check-in to check-out)
            const startDate = booking_start && booking_start.trim() ? booking_start : null;
            const endDate = booking_end && booking_end.trim() ? booking_end : null;
            
            updateQuery = `
                UPDATE marketplace_vouchers 
                SET booking_date = $1, 
                    booking_start = $2, 
                    booking_end = $3, 
                    booking_notes = $4,
                    booking_requested_at = NOW(),
                    status = 'pending_validation',
                    validation_token = $5
                WHERE id = $6
            `;
            updateParams = [booking_date, startDate, endDate, booking_notes || null, validationToken, req.params.id];
        }
        
        await db.pool.query(updateQuery, updateParams);
        
        // Send email to user confirming request received
        const bookingDetails = { booking_date, booking_start, booking_end, booking_notes };
        if (voucher.user_email) {
            await sendBookingRequestToUser(voucher, bookingDetails);
        }
        
        // Send email to site owner with validation link
        await sendBookingRequestToOwner(voucher, bookingDetails, validationToken);
        
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

// POST validate voucher (admin)
router.post('/:id/validate', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/validate called');
    const { validated_by } = req.body;
    
    try {
        const result = await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'validated',
                validated_at = NOW(),
                validated_by = $1,
                validation_token = NULL
            WHERE id = $2
            RETURNING *
        `, [validated_by || 'admin', req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        const voucher = result.rows[0];
        
        // Send confirmation email to buyer
        if (voucher.user_email) {
            await sendBookingConfirmedToUser(voucher);
        }
        
        console.log('✅ Voucher validated:', voucher.code);
        res.json({ success: true, voucher: voucher });
        
    } catch (error) {
        console.error('Error validating voucher:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST reject voucher (admin)
router.post('/:id/reject', async (req, res) => {
    console.log('🎫 POST /api/vouchers/:id/reject called');
    const { reason } = req.body;
    
    try {
        // Get voucher first
        const voucherResult = await db.pool.query(
            'SELECT * FROM marketplace_vouchers WHERE id = $1',
            [req.params.id]
        );
        
        if (voucherResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        
        const voucher = voucherResult.rows[0];
        
        // Reset voucher to active
        const result = await db.pool.query(`
            UPDATE marketplace_vouchers 
            SET status = 'active',
                booking_date = NULL,
                booking_start = NULL,
                booking_end = NULL,
                booking_notes = NULL,
                booking_requested_at = NULL,
                validation_token = NULL
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);
        
        // Send rejection email to buyer
        if (voucher.user_email) {
            await sendBookingRejectedToUser(voucher, reason || 'Date not available');
        }
        
        console.log('❌ Booking rejected for voucher:', voucher.code);
        res.json({ success: true, voucher: result.rows[0] });
        
    } catch (error) {
        console.error('Error rejecting booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST consume voucher (admin - marks as used/redeemed)
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
