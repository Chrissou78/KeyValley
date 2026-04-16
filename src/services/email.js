const nodemailer = require('nodemailer');

// SMTP Configuration for Google Workspace
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const SITE_OWNER_EMAIL = 'julie.meyer@vivapartners.net';
const FROM_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER;
const SITE_URL = process.env.SITE_URL || 'https://keavalley.com';

// Verify connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ SMTP connection error:', error.message);
    } else {
        console.log('✅ SMTP server ready for emails');
    }
});

// ============================================
// EMAIL TEMPLATES
// ============================================

function getBaseTemplate(content) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 0; background-color: #0d0d0d; font-family: 'Helvetica Neue', Arial, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; background-color: #1a1a1a; }
        .header { background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); padding: 30px; text-align: center; }
        .header img { height: 50px; }
        .header h1 { color: #0d0d0d; margin: 15px 0 0; font-size: 24px; }
        .content { padding: 40px 30px; color: #ffffff; }
        .content h2 { color: #daa520; margin-top: 0; }
        .content p { color: #94a3b8; line-height: 1.6; margin: 15px 0; }
        .voucher-code { background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0; }
        .voucher-code span { font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px; }
        .details-box { background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0; }
        .details-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .details-row:last-child { border-bottom: none; }
        .details-label { color: #94a3b8; }
        .details-value { color: #ffffff; font-weight: 600; }
        .btn { display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 20px 0; }
        .btn-secondary { background: transparent; border: 2px solid #daa520; color: #daa520 !important; }
        .footer { background: #0d0d0d; padding: 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1); }
        .footer p { color: #64748b; font-size: 12px; margin: 5px 0; }
        .footer a { color: #daa520; text-decoration: none; }
        .highlight { color: #daa520; font-weight: 600; }
        .amount { font-size: 32px; color: #daa520; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${SITE_URL}/images/logo.png" alt="Kea Valley">
            <h1>Kea Valley Private Members Club</h1>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>Kea Valley Private Members Club</p>
            <p>Questions? Contact us at <a href="mailto:${SITE_OWNER_EMAIL}">${SITE_OWNER_EMAIL}</a></p>
            <p style="margin-top: 15px;">© 2026 Kea Valley. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;
}

// ============================================
// VOUCHER EMAILS
// ============================================

// 1. Purchase confirmation to buyer
async function sendVoucherPurchaseEmail(voucher, userEmail) {
    const content = `
        <h2>Your Voucher is Ready! 🎉</h2>
        <p>Thank you for your purchase. Your voucher has been created and is ready to use.</p>
        
        <div class="voucher-code">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER CODE</p>
            <span>${voucher.code}</span>
        </div>
        
        <div class="details-box">
            <div class="details-row">
                <span class="details-label">Service</span>
                <span class="details-value">${voucher.service_name}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Value</span>
                <span class="details-value">Kea€${voucher.value}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Status</span>
                <span class="details-value" style="color: #10b981;">Active</span>
            </div>
        </div>
        
        <p>To use this voucher, go to your profile and request a booking for your preferred date.</p>
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/profile" class="btn">View My Vouchers</a>
        </div>
        
        <p style="font-size: 13px; color: #64748b; margin-top: 30px;">
            Keep this email safe. You'll need your voucher code when using the service.
        </p>
    `;

    try {
        await transporter.sendMail({
            from: `"Kea Valley" <${FROM_EMAIL}>`,
            to: userEmail,
            subject: `Your Kea Valley Voucher - ${voucher.service_name}`,
            html: getBaseTemplate(content)
        });
        console.log('✅ Purchase email sent to buyer:', userEmail);
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to send purchase email:', error);
        return { success: false, error: error.message };
    }
}

// 2. Purchase notification to site owner
async function sendVoucherPurchaseNotificationToOwner(voucher, userEmail, userName) {
    const content = `
        <h2>New Voucher Purchase 💰</h2>
        <p>A new voucher has been purchased on the marketplace.</p>
        
        <div class="voucher-code">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">VOUCHER CODE</p>
            <span>${voucher.code}</span>
        </div>
        
        <div class="details-box">
            <div class="details-row">
                <span class="details-label">Service</span>
                <span class="details-value">${voucher.service_name}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Amount</span>
                <span class="details-value">Kea€${voucher.value}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Buyer</span>
                <span class="details-value">${userName || 'Member'}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Email</span>
                <span class="details-value">${userEmail || 'N/A'}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Wallet</span>
                <span class="details-value" style="font-size: 12px;">${voucher.wallet_address}</span>
            </div>
        </div>
        
        <p style="color: #94a3b8;">No action needed yet. You'll receive another email when the member requests a booking.</p>
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/admin" class="btn btn-secondary">View in Admin</a>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Kea Valley" <${FROM_EMAIL}>`,
            to: SITE_OWNER_EMAIL,
            subject: `New Voucher Purchase - ${voucher.service_name} - Kea€${voucher.value}`,
            html: getBaseTemplate(content)
        });
        console.log('✅ Purchase notification sent to owner');
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to send owner notification:', error);
        return { success: false, error: error.message };
    }
}

// 3. Booking request to site owner (with validation button)
async function sendBookingRequestEmail(voucher, bookingDetails, validationToken) {
    const validateUrl = `${SITE_URL}/api/vouchers/validate/${validationToken}`;
    
    const dateDisplay = bookingDetails.booking_start && bookingDetails.booking_end
        ? `${bookingDetails.booking_start} → ${bookingDetails.booking_end}`
        : bookingDetails.booking_date || 'Not specified';

    const content = `
        <h2>Booking Request 📅</h2>
        <p>A member has requested a booking for their voucher.</p>
        
        <div class="voucher-code">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">VOUCHER CODE</p>
            <span>${voucher.code}</span>
        </div>
        
        <div class="details-box">
            <div class="details-row">
                <span class="details-label">Service</span>
                <span class="details-value">${voucher.service_name}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Requested Dates</span>
                <span class="details-value" style="color: #daa520;">${dateDisplay}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Member Email</span>
                <span class="details-value">${voucher.user_email || 'N/A'}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Value</span>
                <span class="details-value">Kea€${voucher.value}</span>
            </div>
            ${bookingDetails.booking_notes ? `
            <div class="details-row">
                <span class="details-label">Notes</span>
                <span class="details-value">${bookingDetails.booking_notes}</span>
            </div>
            ` : ''}
        </div>
        
        <p>Click the button below to <strong>confirm this booking</strong>:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${validateUrl}" class="btn">✓ Validate Booking</a>
        </div>
        
        <p style="font-size: 13px; color: #64748b;">
            Or copy this link: <a href="${validateUrl}" style="color: #daa520;">${validateUrl}</a>
        </p>
        
        <div style="text-align: center; margin-top: 20px;">
            <a href="${SITE_URL}/admin" class="btn btn-secondary">Manage in Admin</a>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Kea Valley" <${FROM_EMAIL}>`,
            to: SITE_OWNER_EMAIL,
            subject: `⏳ Booking Request - ${voucher.service_name} - ${dateDisplay}`,
            html: getBaseTemplate(content)
        });
        console.log('✅ Booking request email sent to owner');
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to send booking request email:', error);
        return { success: false, error: error.message };
    }
}

// 4. Booking confirmed to buyer
async function sendBookingConfirmedEmail(voucher) {
    const dateDisplay = voucher.booking_start && voucher.booking_end
        ? `${voucher.booking_start} → ${voucher.booking_end}`
        : voucher.booking_date || 'As confirmed';

    const content = `
        <h2>Booking Confirmed! ✓</h2>
        <p>Great news! Your booking has been confirmed.</p>
        
        <div class="voucher-code">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER CODE</p>
            <span>${voucher.code}</span>
        </div>
        
        <div class="details-box">
            <div class="details-row">
                <span class="details-label">Service</span>
                <span class="details-value">${voucher.service_name}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Confirmed Dates</span>
                <span class="details-value" style="color: #10b981;">${dateDisplay}</span>
            </div>
            <div class="details-row">
                <span class="details-label">Status</span>
                <span class="details-value" style="color: #10b981;">Confirmed</span>
            </div>
        </div>
        
        <p>Please present your voucher code when you arrive. We look forward to seeing you!</p>
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/profile" class="btn">View My Bookings</a>
        </div>
        
        <p style="font-size: 13px; color: #64748b; margin-top: 30px;">
            Need to make changes? Contact us at <a href="mailto:${SITE_OWNER_EMAIL}" style="color: #daa520;">${SITE_OWNER_EMAIL}</a>
        </p>
    `;

    try {
        await transporter.sendMail({
            from: `"Kea Valley" <${FROM_EMAIL}>`,
            to: voucher.user_email,
            subject: `✓ Booking Confirmed - ${voucher.service_name}`,
            html: getBaseTemplate(content)
        });
        console.log('✅ Booking confirmed email sent to:', voucher.user_email);
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to send confirmation email:', error);
        return { success: false, error: error.message };
    }
}

// 5. Log email to database
async function logEmail(db, voucherId, emailType, recipientEmail, subject, status, errorMessage = null) {
    try {
        await db.pool.query(`
            INSERT INTO voucher_emails (voucher_id, email_type, recipient_email, subject, status, error_message)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [voucherId, emailType, recipientEmail, subject, status, errorMessage]);
    } catch (e) {
        console.error('Failed to log email:', e.message);
    }
}

module.exports = {
    transporter,
    sendVoucherPurchaseEmail,
    sendVoucherPurchaseNotificationToOwner,
    sendBookingRequestEmail,
    sendBookingConfirmedEmail,
    logEmail,
    SITE_OWNER_EMAIL
};
