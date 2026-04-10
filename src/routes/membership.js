// src/routes/membership.js
// VERSION: 2026-04-10 - Added test package + fixed 90/10 split on NET
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');
const { sendEmail } = require('../services/email');

const PLATFORM_FEE_PERCENT = 10; // 10% platform fee on NET amount (after Stripe fees)
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

// ============================================
// PACKAGES - Must match frontend
// ============================================
const PACKAGES = {
    'test-10': { 
        name: 'Test Package', 
        price: 10, 
        buyingPower: 10, 
        bonus: 0,
        description: 'Test package for €10'
    },
    silver: { 
        name: 'Silver Membership', 
        price: 3000, 
        buyingPower: 3500, 
        bonus: 500,
        description: 'Perfect for trying out'
    },
    gold: { 
        name: 'Gold Membership', 
        price: 8000,  // Fixed: was 6000, should match frontend
        buyingPower: 10000, 
        bonus: 2000,
        description: 'Best value for members'
    },
    platinum: { 
        name: 'Platinum Membership', 
        price: 20000, 
        buyingPower: 30000, 
        bonus: 10000,
        description: 'Ultimate experience'
    }
};

console.log('✅ Membership routes initialized');
console.log(`   Connected Account: ${CONNECTED_ACCOUNT_ID || 'NOT CONFIGURED'}`);
console.log(`   Platform Fee: ${PLATFORM_FEE_PERCENT}% of NET (after Stripe fees)`);
console.log(`   Packages: ${Object.keys(PACKAGES).join(', ')}`);

// ============================================
// GET /api/membership/packages - List available packages
// ============================================
router.get('/packages', (req, res) => {
    const packages = Object.entries(PACKAGES).map(([key, pkg]) => ({
        id: key,
        name: pkg.name,
        description: pkg.description,
        price: pkg.price,
        buyingPower: pkg.buyingPower,
        bonus: pkg.bonus,
        bonusPercent: pkg.bonus > 0 ? Math.round((pkg.bonus / pkg.price) * 100) : 0
    }));
    
    res.json({ success: true, packages });
});

// ============================================
// GET /api/membership/verify-connect - Verify Stripe Connect setup
// ============================================
router.get('/verify-connect', async (req, res) => {
    if (!CONNECTED_ACCOUNT_ID) {
        return res.json({ 
            success: false, 
            error: 'STRIPE_CONNECTED_ACCOUNT_ID not configured',
            configured: false
        });
    }

    try {
        const account = await stripe.accounts.retrieve(CONNECTED_ACCOUNT_ID);
        
        res.json({
            success: true,
            configured: true,
            account: {
                id: account.id,
                type: account.type,
                country: account.country,
                default_currency: account.default_currency,
                charges_enabled: account.charges_enabled,
                payouts_enabled: account.payouts_enabled,
                capabilities: {
                    card_payments: account.capabilities?.card_payments,
                    transfers: account.capabilities?.transfers
                }
            },
            splitConfig: {
                platformFeePercent: PLATFORM_FEE_PERCENT,
                connectedAccountPercent: 100 - PLATFORM_FEE_PERCENT,
                note: 'Split is calculated on NET amount (after Stripe fees)'
            }
        });
    } catch (error) {
        console.error('Error verifying connected account:', error);
        res.json({ 
            success: false, 
            configured: true,
            error: error.message 
        });
    }
});

// ============================================
// POST /api/membership/create-payment-intent
// ============================================
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { wallet, email, phone, package: packageKey, price, buyingPower } = req.body;

        if (!wallet || !email || !packageKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const pkg = PACKAGES[packageKey];
        if (!pkg) {
            return res.status(400).json({ success: false, error: 'Invalid package' });
        }

        // Verify price matches (allow for minor discrepancies)
        if (Math.abs(pkg.price - price) > 1) {
            console.warn(`Price mismatch for ${packageKey}: expected ${pkg.price}, got ${price}`);
            return res.status(400).json({ success: false, error: 'Price mismatch' });
        }

        // Create order in database
        const orderResult = await pool.query(`
            INSERT INTO membership_purchases 
            (wallet_address, email, phone, package_key, package_name, amount_paid, buying_power_granted, bonus_amount, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment')
            RETURNING id, order_number
        `, [wallet, email, phone, packageKey, pkg.name, pkg.price, pkg.buyingPower, pkg.bonus]);

        const order = orderResult.rows[0];

        // Create Stripe payment intent
        const amountCents = Math.round(pkg.price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'eur',
            metadata: {
                order_id: order.id.toString(),
                order_number: order.order_number,
                wallet_address: wallet,
                email: email,
                package_key: packageKey,
                package_name: pkg.name,
                buying_power: pkg.buyingPower.toString(),
                bonus: pkg.bonus.toString()
            },
            receipt_email: email,
            description: `Kea Valley ${pkg.name}`
        });

        // Update order with payment intent ID
        await pool.query(
            'UPDATE membership_purchases SET payment_intent_id = $1 WHERE id = $2',
            [paymentIntent.id, order.id]
        );

        console.log(`✅ Payment intent created for ${pkg.name}:`, {
            paymentIntentId: paymentIntent.id,
            orderId: order.id,
            orderNumber: order.order_number,
            amount: `€${pkg.price}`,
            wallet: wallet.slice(0, 10) + '...'
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            orderId: order.order_number
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ success: false, error: 'Failed to create payment' });
    }
});

// ============================================
// GET /api/membership/purchase-status/:paymentIntentId
// ============================================
router.get('/purchase-status/:paymentIntentId', async (req, res) => {
    try {
        const { paymentIntentId } = req.params;

        const result = await pool.query(
            'SELECT * FROM membership_purchases WHERE payment_intent_id = $1',
            [paymentIntentId]
        );

        if (result.rows.length === 0) {
            return res.json({ status: 'pending' });
        }

        const order = result.rows[0];

        res.json({
            status: order.status === 'completed' ? 'completed' : 
                    order.status === 'failed' ? 'failed' : 'pending',
            orderId: order.order_number,
            error: order.error_message
        });
    } catch (error) {
        console.error('Error checking purchase status:', error);
        res.status(500).json({ success: false, error: 'Failed to check status' });
    }
});

// ============================================
// Stripe Webhook Handler for Membership
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📥 Membership webhook: ${event.type}`);

    if (event.type === 'payment_intent.succeeded') {
        await handleMembershipPaymentSuccess(event.data.object);
    } else if (event.type === 'payment_intent.payment_failed') {
        await handleMembershipPaymentFailed(event.data.object);
    }

    res.json({ received: true });
});

// ============================================
// Handle Successful Payment - 90/10 Split on NET
// ============================================
async function handleMembershipPaymentSuccess(paymentIntent) {
    const { order_id, wallet_address, email, package_key, buying_power } = paymentIntent.metadata;

    console.log(`\n💳 Processing membership payment: ${paymentIntent.id}`);

    try {
        // Check if already processed
        const existingCheck = await pool.query(
            'SELECT status FROM membership_purchases WHERE id = $1',
            [order_id]
        );
        
        if (existingCheck.rows[0]?.status === 'completed') {
            console.log('⚠️ Payment already processed, skipping');
            return;
        }

        // Get the charge and balance transaction
        const charges = await stripe.charges.list({
            payment_intent: paymentIntent.id,
            limit: 1
        });

        if (charges.data.length === 0) {
            console.error('❌ No charges found for payment intent:', paymentIntent.id);
            return;
        }

        const charge = charges.data[0];
        const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);

        // Calculate amounts
        const chargedAmount = paymentIntent.amount / 100;
        const stripeFee = balanceTransaction.fee / 100;
        const netAmount = balanceTransaction.net / 100;

        // ============================================
        // 90/10 SPLIT ON NET AMOUNT (after Stripe fees)
        // Platform keeps 10% of NET
        // Connected account gets 90% of NET
        // ============================================
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const transferAmount = netAmount * ((100 - PLATFORM_FEE_PERCENT) / 100);

        console.log(`💰 Payment Distribution (90/10 on NET):`);
        console.log(`   Charged:              €${chargedAmount.toFixed(2)}`);
        console.log(`   Stripe Fee:           €${stripeFee.toFixed(2)}`);
        console.log(`   NET Received:         €${netAmount.toFixed(2)}`);
        console.log(`   ─────────────────────────────────`);
        console.log(`   Platform (${PLATFORM_FEE_PERCENT}% of NET):  €${platformFee.toFixed(2)}`);
        console.log(`   Connected (${100-PLATFORM_FEE_PERCENT}% of NET): €${transferAmount.toFixed(2)}`);

        // Update order status
        await pool.query(`
            UPDATE membership_purchases 
            SET status = 'completed',
                payment_status = 'paid',
                stripe_fee = $1,
                net_amount = $2,
                platform_fee = $3,
                transfer_amount = $4,
                completed_at = NOW()
            WHERE id = $5
        `, [stripeFee, netAmount, platformFee, transferAmount, order_id]);

        // Credit buying power to user's account
        const buyingPowerAmount = parseInt(buying_power);
        await pool.query(`
            INSERT INTO token_transactions 
            (wallet_address, amount, type, reference_type, reference_id, description)
            VALUES ($1, $2, 'credit', 'membership_purchase', $3, $4)
        `, [wallet_address, buyingPowerAmount, order_id, `${PACKAGES[package_key]?.name || 'Membership'} purchase`]);

        // Update or create member balance
        await pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = member_balances.total_credited + $2,
                updated_at = NOW()
        `, [wallet_address, buyingPowerAmount]);

        console.log(`✅ Buying power credited: €${buyingPowerAmount} to ${wallet_address.slice(0, 10)}...`);

        // Create transfer to connected account
        if (transferAmount > 0 && CONNECTED_ACCOUNT_ID) {
            try {
                const transfer = await stripe.transfers.create({
                    amount: Math.round(transferAmount * 100),
                    currency: 'eur',
                    destination: CONNECTED_ACCOUNT_ID,
                    transfer_group: paymentIntent.id,
                    metadata: {
                        order_id: order_id,
                        type: 'membership_purchase',
                        package: package_key,
                        charged_amount: chargedAmount.toFixed(2),
                        stripe_fee: stripeFee.toFixed(2),
                        net_amount: netAmount.toFixed(2),
                        platform_fee: platformFee.toFixed(2),
                        platform_fee_percent: PLATFORM_FEE_PERCENT.toString()
                    }
                });

                await pool.query(
                    'UPDATE membership_purchases SET transfer_id = $1 WHERE id = $2',
                    [transfer.id, order_id]
                );

                console.log(`✅ Transfer created: ${transfer.id} → €${transferAmount.toFixed(2)} to connected account`);
            } catch (transferError) {
                console.error('❌ Transfer failed:', transferError.message);
                await pool.query(`
                    INSERT INTO failed_transfers 
                    (order_id, payment_intent_id, error_message, amount)
                    VALUES ($1, $2, $3, $4)
                `, [order_id, paymentIntent.id, transferError.message, transferAmount]);
            }
        } else if (!CONNECTED_ACCOUNT_ID) {
            console.log('⚠️ No connected account configured - skipping transfer');
        }

        // Send confirmation email
        try {
            await sendMembershipConfirmationEmail(email, wallet_address, package_key, buyingPowerAmount);
            console.log(`📧 Confirmation email sent to ${email}`);
        } catch (emailError) {
            console.error('⚠️ Failed to send confirmation email:', emailError.message);
        }

        // Send admin notification
        try {
            await sendAdminMembershipNotification(order_id, email, wallet_address, package_key, chargedAmount, buyingPowerAmount);
        } catch (adminEmailError) {
            console.error('⚠️ Failed to send admin notification:', adminEmailError.message);
        }

        console.log(`✅ Payment processing complete for order ${order_id}\n`);

    } catch (error) {
        console.error('❌ Error handling membership payment success:', error);
        
        // Update order with error
        try {
            await pool.query(
                "UPDATE membership_purchases SET status = 'error', error_message = $1 WHERE id = $2",
                [error.message, order_id]
            );
        } catch (updateError) {
            console.error('Failed to update order with error:', updateError);
        }
    }
}

async function handleMembershipPaymentFailed(paymentIntent) {
    const { order_id } = paymentIntent.metadata;

    console.log(`❌ Payment failed for order ${order_id}: ${paymentIntent.last_payment_error?.message}`);

    try {
        await pool.query(
            "UPDATE membership_purchases SET status = 'failed', payment_status = 'failed', error_message = $1 WHERE id = $2",
            [paymentIntent.last_payment_error?.message || 'Payment failed', order_id]
        );
    } catch (error) {
        console.error('Error handling failed membership payment:', error);
    }
}

async function sendMembershipConfirmationEmail(email, wallet, packageKey, buyingPower) {
    const pkg = PACKAGES[packageKey] || { name: 'Membership' };

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #ee9d2b;">Welcome to Kea Valley!</h1>
            <p>Your membership has been activated and your buying power is ready to use.</p>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #333;">${pkg.name}</h3>
                <p style="font-size: 24px; color: #10b981; margin: 10px 0;"><strong>€${buyingPower.toLocaleString()}</strong> Buying Power</p>
                <p style="color: #666;">Connected wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)}</p>
            </div>
            
            <p>You can now browse our marketplace and book premium services using your buying power.</p>
            
            <a href="${process.env.APP_URL || 'https://keavalley.com'}/marketplace" style="display: inline-block; background: #ee9d2b; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Browse Marketplace</a>
            
            <p style="color: #666;">If you have any questions, please contact us at support@keavalley.com</p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">Kea Valley Private Members Club</p>
        </div>
    `;

    await sendEmail({
        to: email,
        subject: `Welcome to Kea Valley - ${pkg.name} Activated`,
        html
    });
}

async function sendAdminMembershipNotification(orderId, email, wallet, packageKey, amount, buyingPower) {
    const pkg = PACKAGES[packageKey] || { name: 'Membership' };

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #ee9d2b;">New Membership Purchase!</h1>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${pkg.name}</h3>
                <p><strong>Order ID:</strong> ${orderId}</p>
                <p><strong>Customer:</strong> ${email}</p>
                <p><strong>Wallet:</strong> ${wallet}</p>
                <p><strong>Amount Paid:</strong> €${amount.toLocaleString()}</p>
                <p><strong>Buying Power Granted:</strong> €${buyingPower.toLocaleString()}</p>
            </div>
            
            <a href="${process.env.ADMIN_URL || process.env.APP_URL}/admin/memberships/${orderId}" style="display: inline-block; background: #ee9d2b; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View in Admin</a>
        </div>
    `;

    await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `[NEW MEMBERSHIP] ${pkg.name} - €${amount.toLocaleString()}`,
        html
    });
}

module.exports = router;
