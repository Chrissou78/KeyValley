// src/routes/membership.js
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');
const { sendEmail } = require('../services/email');

const PLATFORM_FEE_PERCENT = 10; // 10% platform fee
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

const PACKAGES = {
    silver: { name: 'Silver Membership', price: 3000, buyingPower: 3500, bonus: 500 },
    gold: { name: 'Gold Membership', price: 6000, buyingPower: 8000, bonus: 2000 },
    platinum: { name: 'Platinum Membership', price: 20000, buyingPower: 30000, bonus: 10000 }
};

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
        if (!pkg || pkg.price !== price) {
            return res.status(400).json({ success: false, error: 'Invalid package' });
        }

        // Create order in database
        const orderResult = await pool.query(`
            INSERT INTO membership_purchases 
            (wallet_address, email, phone, package_key, package_name, amount_paid, buying_power_granted, bonus_amount, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment')
            RETURNING id, order_number
        `, [wallet, email, phone, packageKey, pkg.name, price, buyingPower, pkg.bonus]);

        const order = orderResult.rows[0];

        // Create Stripe payment intent
        const amountCents = Math.round(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'eur',
            metadata: {
                order_id: order.id,
                order_number: order.order_number,
                wallet_address: wallet,
                email: email,
                package_key: packageKey,
                buying_power: buyingPower.toString()
            },
            receipt_email: email
        });

        // Update order with payment intent ID
        await pool.query(
            'UPDATE membership_purchases SET payment_intent_id = $1 WHERE id = $2',
            [paymentIntent.id, order.id]
        );

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

    if (event.type === 'payment_intent.succeeded') {
        await handleMembershipPaymentSuccess(event.data.object);
    } else if (event.type === 'payment_intent.payment_failed') {
        await handleMembershipPaymentFailed(event.data.object);
    }

    res.json({ received: true });
});

async function handleMembershipPaymentSuccess(paymentIntent) {
    const { order_id, wallet_address, email, package_key, buying_power } = paymentIntent.metadata;

    try {
        // Get the charge and balance transaction
        const charges = await stripe.charges.list({
            payment_intent: paymentIntent.id,
            limit: 1
        });

        if (charges.data.length === 0) {
            console.error('No charges found for payment intent:', paymentIntent.id);
            return;
        }

        const charge = charges.data[0];
        const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);

        // Calculate amounts
        const chargedAmount = paymentIntent.amount / 100;
        const stripeFee = balanceTransaction.fee / 100;
        const netAmount = balanceTransaction.net / 100;

        // Platform fee is 10% of the original charged amount
        const platformFee = chargedAmount * (PLATFORM_FEE_PERCENT / 100);
        
        // Amount to send to connected account = net amount - platform fee
        const transferAmount = Math.max(0, netAmount - platformFee);

        console.log(`Membership payment distribution for order ${order_id}:`);
        console.log(`  Charged: €${chargedAmount}`);
        console.log(`  Stripe fee: €${stripeFee.toFixed(2)}`);
        console.log(`  Net received: €${netAmount.toFixed(2)}`);
        console.log(`  Platform fee (10%): €${platformFee.toFixed(2)}`);
        console.log(`  Transfer to connected: €${transferAmount.toFixed(2)}`);

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

        // Create transfer to connected account
        if (transferAmount > 0 && CONNECTED_ACCOUNT_ID) {
            try {
                const transfer = await stripe.transfers.create({
                    amount: Math.round(transferAmount * 100),
                    currency: 'eur',
                    destination: CONNECTED_ACCOUNT_ID,
                    metadata: {
                        order_id,
                        type: 'membership_purchase',
                        package: package_key,
                        charged_amount: chargedAmount.toString(),
                        stripe_fee: stripeFee.toFixed(2),
                        platform_fee: platformFee.toFixed(2)
                    }
                });

                await pool.query(
                    'UPDATE membership_purchases SET transfer_id = $1 WHERE id = $2',
                    [transfer.id, order_id]
                );

                console.log(`Transfer created: ${transfer.id}`);
            } catch (transferError) {
                console.error('Transfer failed:', transferError);
                await pool.query(`
                    INSERT INTO failed_transfers 
                    (order_id, payment_intent_id, error_message, amount)
                    VALUES ($1, $2, $3, $4)
                `, [order_id, paymentIntent.id, transferError.message, transferAmount]);
            }
        }

        // Send confirmation email
        await sendMembershipConfirmationEmail(email, wallet_address, package_key, buyingPowerAmount);

        // Send admin notification
        await sendAdminMembershipNotification(order_id, email, wallet_address, package_key, chargedAmount, buyingPowerAmount);

    } catch (error) {
        console.error('Error handling membership payment success:', error);
    }
}

async function handleMembershipPaymentFailed(paymentIntent) {
    const { order_id } = paymentIntent.metadata;

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
            
            <a href="${process.env.ADMIN_URL}/memberships/${orderId}" style="display: inline-block; background: #ee9d2b; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View in Admin</a>
        </div>
    `;

    await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `[NEW MEMBERSHIP] ${pkg.name} - €${amount.toLocaleString()}`,
        html
    });
}

module.exports = router;
