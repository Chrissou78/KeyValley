// src/services/email-webhook.js
// VERSION: 2026-04-25 - Complete email service via WalletTwo webhook
// 
// EMAILS SENT:
// 1. Package purchased → buyer (receipt) + owner (notification)
// 2. Voucher purchased → buyer (voucher details) + owner (notification)
// 3. Voucher booking requested → buyer (confirmation) + owner (confirm/decline buttons)
// 4. Voucher booking confirmed → buyer (confirmed details)
// 5. Voucher booking rejected → buyer (rejected + can rebook)

const WALLETTWO_EMAIL_WEBHOOK = process.env.WALLETTWO_EMAIL_WEBHOOK;
const SITE_OWNER_EMAIL = process.env.SITE_OWNER_EMAIL || 'julie.meyer@vivapartners.net';
const SITE_URL = process.env.SITE_URL || 'https://keavalley.com';

// ============================================
// CORE EMAIL FUNCTION
// ============================================

async function sendEmail(email, htmlContent) {
    if (!WALLETTWO_EMAIL_WEBHOOK) {
        console.error('❌ WALLETTWO_EMAIL_WEBHOOK not configured');
        return { success: false, error: 'Email webhook not configured' };
    }
    
    if (!email) {
        console.error('❌ No email address provided');
        return { success: false, error: 'No email address' };
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

// ============================================
// BASE TEMPLATE
// ============================================

function getBaseTemplate(content) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0d0d0d; font-family: 'Helvetica Neue', Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #1a1a1a;">
        <div style="background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); padding: 30px; text-align: center;">
            <img src="${SITE_URL}/images/logo.png" alt="Kea Valley" style="height: 50px;">
            <h1 style="color: #0d0d0d; margin: 15px 0 0; font-size: 24px;">Kea Valley Private Members Club</h1>
        </div>
        <div style="padding: 40px 30px; color: #ffffff;">
            ${content}
        </div>
        <div style="background: #0d0d0d; padding: 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="color: #64748b; font-size: 12px; margin: 5px 0;">Kea Valley Private Members Club</p>
            <p style="color: #64748b; font-size: 12px; margin: 5px 0;">Questions? Contact us at <a href="mailto:${SITE_OWNER_EMAIL}" style="color: #daa520; text-decoration: none;">${SITE_OWNER_EMAIL}</a></p>
            <p style="color: #64748b; font-size: 12px; margin: 15px 0 0;">© 2026 Kea Valley. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;
}

// ============================================
// 1. PACKAGE/MEMBERSHIP PURCHASE EMAILS
// ============================================

/**
 * Send membership purchase receipt to buyer
 */
async function sendMembershipReceiptToBuyer(data) {
    const { 
        userEmail, 
        packageName, 
        amountPaid, 
        buyingPower, 
        orderNumber,
        walletAddress 
    } = data;
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">Welcome to Kea Valley! 🎉</h2>
        <p style="color: #94a3b8; line-height: 1.6;">Thank you for your purchase. Your Kea Euros have been added to your account.</p>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR NEW BALANCE</p>
            <span style="font-size: 36px; font-weight: bold; color: #10b981;">Kea€${buyingPower.toLocaleString()}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <p style="color: #daa520; font-weight: 600; margin: 0 0 15px; font-size: 14px; text-transform: uppercase;">Payment Receipt</p>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Package</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${packageName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Amount Paid</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">€${amountPaid.toLocaleString()}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Kea€ Received</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${buyingPower.toLocaleString()}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Order ID</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${orderNumber}</td>
                </tr>
            </table>
        </div>
        
        <p style="color: #94a3b8; line-height: 1.6;">Your Kea Euros are ready to use in the marketplace. Browse premium services and experiences!</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${SITE_URL}/marketplace" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Browse Marketplace</a>
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin-top: 30px;">
            Wallet: ${walletAddress ? walletAddress.slice(0, 10) + '...' + walletAddress.slice(-8) : 'N/A'}
        </p>
    `;
    
    return sendEmail(userEmail, getBaseTemplate(content));
}

/**
 * Send membership purchase notification to site owner
 */
async function sendMembershipNotificationToOwner(data) {
    const { 
        userEmail, 
        packageName, 
        amountPaid, 
        buyingPower, 
        orderNumber,
        walletAddress,
        stripeFee,
        netAmount,
        platformFee,
        partnerAmount
    } = data;
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">New Membership Purchase 💰</h2>
        <p style="color: #94a3b8; line-height: 1.6;">A new membership package has been purchased.</p>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <span style="font-size: 32px; font-weight: bold; color: #10b981;">+€${amountPaid.toLocaleString()}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <p style="color: #daa520; font-weight: 600; margin: 0 0 15px; font-size: 14px; text-transform: uppercase;">Purchase Details</p>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Package</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${packageName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Amount Paid</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">€${amountPaid.toLocaleString()}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Kea€ Granted</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${buyingPower.toLocaleString()}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Buyer Email</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${userEmail || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Order ID</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${orderNumber}</td>
                </tr>
            </table>
        </div>
        
        ${stripeFee !== undefined ? `
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <p style="color: #daa520; font-weight: 600; margin: 0 0 15px; font-size: 14px; text-transform: uppercase;">Payment Split</p>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Stripe Fee</td>
                    <td style="color: #ef4444; font-weight: 600; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">-€${(stripeFee || 0).toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Net Amount</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">€${(netAmount || 0).toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Platform Fee (10%)</td>
                    <td style="color: #f59e0b; font-weight: 600; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">€${(platformFee || 0).toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 8px 0;">Your Share (90%)</td>
                    <td style="color: #10b981; font-weight: 600; padding: 8px 0; text-align: right;">€${(partnerAmount || 0).toFixed(2)}</td>
                </tr>
            </table>
        </div>
        ` : ''}
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/admin" style="display: inline-block; background: transparent; border: 2px solid #daa520; color: #daa520 !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View in Admin</a>
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin-top: 30px;">
            Wallet: ${walletAddress || 'N/A'}
        </p>
    `;
    
    return sendEmail(SITE_OWNER_EMAIL, getBaseTemplate(content));
}

// ============================================
// 2. VOUCHER PURCHASE EMAILS
// ============================================

/**
 * Send voucher purchase confirmation to buyer
 */
async function sendVoucherPurchaseToBuyer(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        value, 
        orderNumber,
        validUntil
    } = data;
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">Your Voucher is Ready! 🎟️</h2>
        <p style="color: #94a3b8; line-height: 1.6;">Thank you for your purchase. Your voucher has been created and is ready to use.</p>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER CODE</p>
            <span style="font-size: 32px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Value</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${value.toLocaleString()}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Status</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Active</td>
                </tr>
                ${validUntil ? `
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Valid Until</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${validUntil}</td>
                </tr>
                ` : ''}
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Order ID</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${orderNumber}</td>
                </tr>
            </table>
        </div>
        
        <p style="color: #94a3b8; line-height: 1.6;"><strong>How to use your voucher:</strong></p>
        <ol style="color: #94a3b8; line-height: 1.8; padding-left: 20px;">
            <li>Go to your profile</li>
            <li>Find this voucher in "My Vouchers"</li>
            <li>Click "Request Booking" and select your preferred date</li>
            <li>Wait for confirmation (usually within 24-48 hours)</li>
        </ol>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View My Vouchers</a>
        </div>
        
        <p style="font-size: 13px; color: #64748b; margin-top: 30px;">
            Keep this email safe. You'll need your voucher code when using the service.
        </p>
    `;
    
    return sendEmail(userEmail, getBaseTemplate(content));
}

/**
 * Send voucher purchase notification to site owner
 */
async function sendVoucherPurchaseToOwner(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        value, 
        orderNumber,
        walletAddress,
        quantity
    } = data;
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">New Voucher Purchase 🎟️</h2>
        <p style="color: #94a3b8; line-height: 1.6;">A new voucher has been purchased on the marketplace.</p>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">VOUCHER CODE</p>
            <span style="font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Value</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${value.toLocaleString()}</td>
                </tr>
                ${quantity > 1 ? `
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Quantity</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${quantity}</td>
                </tr>
                ` : ''}
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Buyer Email</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${userEmail || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Order ID</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${orderNumber}</td>
                </tr>
            </table>
        </div>
        
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 15px; margin: 20px 0; color: #f59e0b;">
            <strong>No action needed yet.</strong><br>
            You'll receive another email when the member requests a booking date.
        </div>
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/admin" style="display: inline-block; background: transparent; border: 2px solid #daa520; color: #daa520 !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View in Admin</a>
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin-top: 30px;">
            Wallet: ${walletAddress || 'N/A'}
        </p>
    `;
    
    return sendEmail(SITE_OWNER_EMAIL, getBaseTemplate(content));
}

// ============================================
// 3. VOUCHER BOOKING REQUEST EMAILS
// ============================================

/**
 * Send booking request confirmation to user
 */
async function sendBookingRequestToBuyer(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        bookingDate, 
        bookingStart, 
        bookingEnd,
        bookingNotes
    } = data;
    
    const dateDisplay = bookingStart && bookingEnd
        ? `${bookingDate} (${bookingStart} - ${bookingEnd})`
        : bookingDate || 'Not specified';
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">Booking Request Submitted 📅</h2>
        <p style="color: #94a3b8; line-height: 1.6;">Your booking request has been submitted and is awaiting confirmation.</p>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER</p>
            <span style="font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Requested Date</td>
                    <td style="color: #daa520; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${dateDisplay}</td>
                </tr>
                ${bookingNotes ? `
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Notes</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${bookingNotes}</td>
                </tr>
                ` : ''}
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Status</td>
                    <td style="color: #f59e0b; font-weight: 600; padding: 10px 0; text-align: right;">⏳ Pending Confirmation</td>
                </tr>
            </table>
        </div>
        
        <p style="color: #94a3b8; line-height: 1.6;">You will receive an email once your booking is confirmed. This usually takes 24-48 hours.</p>
        
        <div style="text-align: center;">
            <a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View My Vouchers</a>
        </div>
    `;
    
    return sendEmail(userEmail, getBaseTemplate(content));
}

/**
 * Send booking request to site owner (with Confirm/Decline buttons)
 */
async function sendBookingRequestToOwner(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        value,
        bookingDate, 
        bookingStart, 
        bookingEnd,
        bookingNotes,
        confirmToken,
        rejectToken
    } = data;
    
    const confirmUrl = `${SITE_URL}/api/vouchers/validate/${confirmToken}`;
    const rejectUrl = `${SITE_URL}/api/vouchers/reject/${rejectToken}`;
    
    const dateDisplay = bookingStart && bookingEnd
        ? `${bookingDate} (${bookingStart} - ${bookingEnd})`
        : bookingDate || 'Not specified';
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">New Booking Request 📅</h2>
        <p style="color: #94a3b8; line-height: 1.6;">A member has requested to use their voucher.</p>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">VOUCHER CODE</p>
            <span style="font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Requested Date</td>
                    <td style="color: #daa520; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${dateDisplay}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Member Email</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${userEmail || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Value</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">Kea€${value}</td>
                </tr>
                ${bookingNotes ? `
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Notes</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; text-align: right;">${bookingNotes}</td>
                </tr>
                ` : ''}
            </table>
        </div>
        
        <p style="text-align: center; margin: 30px 0;">
            <a href="${confirmUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 5px;">✓ Confirm Booking</a>
            <a href="${rejectUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); color: #ffffff !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 5px;">✕ Decline</a>
        </p>
        
        <p style="font-size: 13px; color: #64748b; text-align: center;">
            Or manage all bookings in the <a href="${SITE_URL}/admin" style="color: #daa520;">Admin Panel</a>
        </p>
    `;
    
    return sendEmail(SITE_OWNER_EMAIL, getBaseTemplate(content));
}

// ============================================
// 4. VOUCHER BOOKING CONFIRMED EMAIL
// ============================================

/**
 * Send booking confirmed email to user
 */
async function sendBookingConfirmedToBuyer(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        bookingDate, 
        bookingStart, 
        bookingEnd
    } = data;
    
    const dateDisplay = bookingStart && bookingEnd
        ? `${bookingDate} (${bookingStart} - ${bookingEnd})`
        : bookingDate || 'As confirmed';
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">Booking Confirmed! ✓</h2>
        <p style="color: #94a3b8; line-height: 1.6;">Great news! Your booking has been confirmed.</p>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 2px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 5px; color: #10b981; font-size: 14px;">CONFIRMED</p>
            <span style="font-size: 24px; font-weight: bold; color: #10b981;">${dateDisplay}</span>
        </div>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER CODE</p>
            <span style="font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Date</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${dateDisplay}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Status</td>
                    <td style="color: #10b981; font-weight: 600; padding: 10px 0; text-align: right;">✓ Confirmed</td>
                </tr>
            </table>
        </div>
        
        <p style="color: #94a3b8; line-height: 1.6;">Please arrive on time and present your voucher code. We look forward to seeing you!</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">View My Bookings</a>
        </div>
        
        <p style="font-size: 13px; color: #64748b; margin-top: 30px; text-align: center;">
            Need to make changes? Contact us at <a href="mailto:${SITE_OWNER_EMAIL}" style="color: #daa520;">${SITE_OWNER_EMAIL}</a>
        </p>
    `;
    
    return sendEmail(userEmail, getBaseTemplate(content));
}

// ============================================
// 5. VOUCHER BOOKING REJECTED EMAIL
// ============================================

/**
 * Send booking rejected email to user
 */
async function sendBookingRejectedToBuyer(data) {
    const { 
        userEmail, 
        voucherCode, 
        serviceName, 
        bookingDate,
        reason
    } = data;
    
    const content = `
        <h2 style="color: #daa520; margin-top: 0;">Booking Update</h2>
        <p style="color: #94a3b8; line-height: 1.6;">Unfortunately, your booking request could not be confirmed for the requested date.</p>
        
        <div style="background: #0d0d0d; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Service</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${serviceName}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">Requested Date</td>
                    <td style="color: #ffffff; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right;">${bookingDate || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="color: #94a3b8; padding: 10px 0;">Reason</td>
                    <td style="color: #f59e0b; font-weight: 600; padding: 10px 0; text-align: right;">${reason || 'Date not available'}</td>
                </tr>
            </table>
        </div>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 15px; margin: 20px 0; color: #10b981;">
            <strong>Your voucher is still valid!</strong><br>
            You can request a different date at any time.
        </div>
        
        <div style="background: rgba(218, 165, 32, 0.1); border: 2px dashed #daa520; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
            <p style="margin: 0 0 10px; color: #94a3b8; font-size: 14px;">YOUR VOUCHER</p>
            <span style="font-size: 28px; font-weight: bold; color: #daa520; letter-spacing: 3px;">${voucherCode}</span>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${SITE_URL}/profile" style="display: inline-block; background: linear-gradient(135deg, #daa520 0%, #f4d03f 100%); color: #0d0d0d !important; padding: 15px 35px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Request New Date</a>
        </div>
    `;
    
    return sendEmail(userEmail, getBaseTemplate(content));
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Core
    sendEmail,
    getBaseTemplate,
    
    // 1. Membership/Package purchases
    sendMembershipReceiptToBuyer,
    sendMembershipNotificationToOwner,
    
    // 2. Voucher purchases
    sendVoucherPurchaseToBuyer,
    sendVoucherPurchaseToOwner,
    
    // 3. Booking requests
    sendBookingRequestToBuyer,
    sendBookingRequestToOwner,
    
    // 4. Booking confirmed
    sendBookingConfirmedToBuyer,
    
    // 5. Booking rejected
    sendBookingRejectedToBuyer,
    
    // Constants
    SITE_OWNER_EMAIL,
    SITE_URL
};
