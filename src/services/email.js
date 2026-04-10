// src/services/email.js
// Email service stub - replace with actual implementation (SendGrid, Nodemailer, etc.)

async function sendEmail({ to, subject, html, text }) {
    // TODO: Implement actual email sending
    console.log('📧 Email would be sent:', { to, subject });
    
    // For now, just log and return success
    // Replace this with your email provider (SendGrid, AWS SES, Nodemailer, etc.)
    
    return { success: true, messageId: `stub-${Date.now()}` };
}

async function sendMembershipConfirmation(email, data) {
    const { orderNumber, packageName, amountPaid, buyingPower, walletAddress } = data;
    
    return sendEmail({
        to: email,
        subject: `Membership Purchase Confirmed - ${orderNumber}`,
        html: `
            <h1>Thank you for your purchase!</h1>
            <p>Your membership package <strong>${packageName}</strong> has been activated.</p>
            <ul>
                <li>Order Number: ${orderNumber}</li>
                <li>Amount Paid: €${amountPaid}</li>
                <li>Buying Power: €${buyingPower}</li>
                <li>Wallet: ${walletAddress}</li>
            </ul>
        `
    });
}

async function sendAdminNotification(data) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@keyvalley.com';
    const { orderNumber, packageName, amountPaid, walletAddress } = data;
    
    return sendEmail({
        to: adminEmail,
        subject: `New Membership Purchase - ${orderNumber}`,
        html: `
            <h1>New Membership Purchase</h1>
            <ul>
                <li>Order: ${orderNumber}</li>
                <li>Package: ${packageName}</li>
                <li>Amount: €${amountPaid}</li>
                <li>Wallet: ${walletAddress}</li>
            </ul>
        `
    });
}

module.exports = {
    sendEmail,
    sendMembershipConfirmation,
    sendAdminNotification
};
