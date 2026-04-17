// src/routes/membership.js
// VERSION: 2026-04-10 - Packages from DB + 90/10 split on NET
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db-postgres');
const { sendEmail } = require('../services/email');

const PLATFORM_FEE_PERCENT = 10; // 10% platform fee on NET amount (after Stripe fees)
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

console.log('✅ Membership routes initialized');
console.log(`   Connected Account: ${CONNECTED_ACCOUNT_ID || 'NOT CONFIGURED'}`);
console.log(`   Platform Fee: ${PLATFORM_FEE_PERCENT}% of NET (after Stripe fees)`);

// ============================================
// Helper: Get package from database
// ============================================
async function getPackage(id) {
    try {
        const result = await pool.query(
            'SELECT * FROM membership_packages WHERE id = $1 AND active = true',
            [id]
        );
        
        if (result.rows.length === 0) return null;
        
        const p = result.rows[0];
        return {
            id: p.id,
            name: p.name,
            description: p.description,
            price: parseFloat(p.price),
            currency: p.currency || 'eur',
            buyingPower: parseFloat(p.buying_power),
            bonus: parseFloat(p.bonus || 0),
            tier: p.tier,
            icon: p.icon,
            features: p.features || []
        };
    } catch (error) {
        console.error('Error fetching package:', error);
        return null;
    }
}

// ============================================
// GET /api/membership/packages - List available packages
// ============================================
router.get('/packages', async (req, res) => {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        
        const result = await pool.query(`
            SELECT id, name, description, price, currency, buyingPower, bonus,
                   CASE WHEN price > 0 THEN ROUND((bonus / price) * 100) ELSE 0 END as bonus_percent,
                   tier, icon, features, popular
            FROM membership_packages 
            WHERE active = true 
              AND ($1 = false OR test_only = false)
            ORDER BY sort_order ASC
        `, [isProduction]);

        const packages = result.rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: parseFloat(p.price),
            currency: (p.currency || 'eur').toUpperCase(),
            buyingPower: parseFloat(p.buying_power),
            bonus: parseFloat(p.bonus || 0),
            bonusPercent: parseInt(p.bonus_percent || 0),
            tier: p.tier,
            icon: p.icon,
            features: p.features || [],
            popular: p.popular || false
        }));

        res.json({ success: true, packages });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ success: false, error: 'Failed to load packages' });
    }
});

// ============================================
// GET /api/membership/packages/:id - Get single package
// ============================================
router.get('/packages/:id', async (req, res) => {
    try {
        const pkg = await getPackage(req.params.id);
        
        if (!pkg) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        res.json({ success: true, package: pkg });
    } catch (error) {
        console.error('Error fetching package:', error);
        res.status(500).json({ success: false, error: 'Failed to load package' });
    }
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

// POST /api/membership/mint-and-capture
router.post('/mint-and-capture', async (req, res) => {
    const { paymentIntentId, orderId, walletAddress, packageId } = req.body;
    
    console.log('🔄 Mint-and-capture started:', { paymentIntentId, orderId, walletAddress, packageId });
    
    try {
        // 1. Get the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'requires_capture') {
            return res.status(400).json({ 
                success: false, 
                error: 'Payment not ready for capture. Status: ' + paymentIntent.status 
            });
        }
        
        // 2. Get package details
        const pkg = await getPackage(packageId);
        if (!pkg) {
            // Cancel the payment intent
            await stripe.paymentIntents.cancel(paymentIntentId);
            return res.status(404).json({ success: false, error: 'Package not found' });
        }
        
        const buyingPowerAmount = parseFloat(pkg.buyingPower);
        const walletLower = walletAddress.toLowerCase();
        
        // 3. MINT TOKENS FIRST
        let mintTxHash = null;
        try {
            console.log('🪙 Minting', buyingPowerAmount, 'tokens to', walletLower);
            
            // Load ethers
            const { ethers } = require('ethers');
            const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
            const minterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            
            const tokenContract = new ethers.Contract(
                process.env.TOKEN_ADDRESS_POLYGON,
                ['function mint(address to, uint256 amount) external'],
                minterWallet
            );
            
            // Mint with proper decimals (assuming 18)
            const mintAmount = ethers.parseUnits(buyingPowerAmount.toString(), 18);
            const tx = await tokenContract.mint(walletAddress, mintAmount);
            const receipt = await tx.wait();
            
            mintTxHash = receipt.hash;
            console.log('✅ Tokens minted! TX:', mintTxHash);
            
        } catch (mintError) {
            console.error('❌ Minting failed:', mintError.message);
            
            // CANCEL the payment - don't charge the user
            await stripe.paymentIntents.cancel(paymentIntentId);
            
            // Update order status
            await pool.query(
                `UPDATE membership_purchases SET status = 'mint_failed', error_message = $1 WHERE payment_intent_id = $2`,
                [mintError.message, paymentIntentId]
            );
            
            return res.status(500).json({ 
                success: false, 
                error: 'Token minting failed. Your card was not charged.' 
            });
        }
        
        // 4. CAPTURE PAYMENT (only after successful mint)
        console.log('💳 Capturing payment...');
        const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
        console.log('✅ Payment captured!');
        
        // 5. Credit database balance
        await pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = member_balances.total_credited + $2,
                updated_at = NOW()
        `, [walletLower, buyingPowerAmount]);
        
        console.log('✅ Database balance credited:', buyingPowerAmount);
        
        // 6. Calculate fees and update order
        const amountReceived = capturedIntent.amount_received / 100;
        let stripeFee = amountReceived * 0.029 + 0.25; // Estimate
        
        // Try to get actual fee
        try {
            if (capturedIntent.latest_charge) {
                const charge = await stripe.charges.retrieve(capturedIntent.latest_charge);
                if (charge.balance_transaction) {
                    const balanceTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
                    stripeFee = balanceTx.fee / 100;
                }
            }
        } catch (e) {
            console.log('Using estimated Stripe fee');
        }
        
        const netAmount = amountReceived - stripeFee;
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const partnerAmount = netAmount - platformFee;
        
        // Update order with all details
        await pool.query(`
            UPDATE membership_purchases 
            SET status = 'completed',
                stripe_fee = $1,
                net_amount = $2,
                platform_fee = $3,
                partner_amount = $4,
                completed_at = NOW(),
                metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{mint_tx_hash}',
                    $5::jsonb
                )
            WHERE payment_intent_id = $6
        `, [stripeFee, netAmount, platformFee, partnerAmount, JSON.stringify(mintTxHash), paymentIntentId]);
        
        // 7. Transfer to connected account (if configured)
        if (CONNECTED_ACCOUNT_ID && partnerAmount > 0) {
            try {
                await stripe.transfers.create({
                    amount: Math.round(partnerAmount * 100),
                    currency: 'eur',
                    destination: CONNECTED_ACCOUNT_ID,
                    transfer_group: orderId,
                    metadata: { order_id: orderId, package_id: packageId }
                });
                console.log('✅ Transfer to partner:', partnerAmount);
            } catch (e) {
                console.error('Transfer failed:', e.message);
            }
        }
        
        // 8. Send confirmation email (non-blocking)
        // ... your email logic here ...
        
        res.json({
            success: true,
            order_id: orderId,
            mint_tx_hash: mintTxHash,
            buying_power: buyingPowerAmount,
            message: 'Tokens minted and payment captured successfully'
        });
        
    } catch (error) {
        console.error('❌ Mint-and-capture error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============================================
// POST /api/membership/create-payment-intent
// ============================================
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { wallet, email, phone, package: packageKey, price, buyingPower } = req.body;

        if (!wallet || !packageKey) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Get package from database
        const pkg = await getPackage(packageKey);
        if (!pkg) {
            return res.status(400).json({ success: false, error: 'Invalid or inactive package' });
        }

        // Verify price matches
        if (price && Math.abs(pkg.price - price) > 1) {
            console.warn(`Price mismatch for ${packageKey}: expected ${pkg.price}, got ${price}`);
            return res.status(400).json({ success: false, error: 'Price mismatch - please refresh the page' });
        }

        // Generate order number
        const orderNumber = 'KV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

        // Create order in database
        const orderResult = await pool.query(`
            INSERT INTO membership_purchases 
            (order_number, package, package_type, amount_paid, buying_power_granted, status, payment_method, metadata)
            VALUES ($1, $2, $3, $4, $5, 'pending_payment', 'stripe', $6)
            RETURNING id, order_number
        `, [
            orderNumber,
            packageKey,
            pkg.tier || 'standard',
            pkg.price,
            pkg.buyingPower,
            JSON.stringify({ 
                wallet_address: wallet, 
                email: email || null, 
                phone: phone || null,
                package_name: pkg.name,
                bonus: pkg.bonus 
            })
        ]);

        const order = orderResult.rows[0];
        const amountCents = Math.round(pkg.price * 100);

        // Create Stripe payment intent with MANUAL CAPTURE
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: pkg.currency,
            capture_method: 'manual', 
            metadata: {
                order_id: order.id.toString(),
                order_number: order.order_number,
                wallet_address: wallet,
                email: email || '',
                package_key: packageKey,
                package_name: pkg.name,
                buying_power: pkg.buyingPower.toString(),
                bonus: pkg.bonus.toString()
            },
            receipt_email: email || undefined,
            description: `Kea Valley ${pkg.name}`
        });

        // Update order with payment intent ID
        await pool.query(
            'UPDATE membership_purchases SET payment_intent_id = $1 WHERE id = $2',
            [paymentIntent.id, order.id]
        );

        console.log(`✅ Payment intent created (manual capture) for ${pkg.name}:`, {
            paymentIntentId: paymentIntent.id,
            orderId: order.id,
            orderNumber: order.order_number,
            amount: `€${pkg.price}`,
            wallet: wallet.slice(0, 10) + '...'
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            orderId: order.order_number,
            paymentIntentId: paymentIntent.id
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
            'SELECT status FROM membership_purchases WHERE payment_intent_id = $1',
            [paymentIntent.id]
        );

        if (existingCheck.rows[0]?.status === 'completed') {
            console.log('⚠️ Already processed by mint-and-capture, skipping webhook');
            return;
        }

        // Get package from database for email templates
        const pkg = await getPackage(package_key);

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

        // 90/10 SPLIT ON NET AMOUNT
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const transferAmount = netAmount * ((100 - PLATFORM_FEE_PERCENT) / 100);

        console.log(`💰 Payment Distribution (90/10 on NET):`);
        console.log(`   Charged:              €${chargedAmount.toFixed(2)}`);
        console.log(`   Stripe Fee:           €${stripeFee.toFixed(2)}`);
        console.log(`   NET Received:         €${netAmount.toFixed(2)}`);
        console.log(`   Platform (${PLATFORM_FEE_PERCENT}% of NET):  €${platformFee.toFixed(2)}`);
        console.log(`   Connected (${100-PLATFORM_FEE_PERCENT}% of NET): €${transferAmount.toFixed(2)}`);

        // Update order status - using actual column names
        await pool.query(`
            UPDATE membership_purchases 
            SET status = 'completed',
                stripe_fee = $1,
                net_amount = $2,
                platform_fee = $3,
                transfer_amount = $4
            WHERE id = $5
        `, [stripeFee, netAmount, platformFee, transferAmount, order_id]);

        // Credit Kea Euros to user's account
        const buyingPowerAmount = parseFloat(buying_power);
        
        // Check if token_transactions table exists, if not just log
        try {
            await pool.query(`
                INSERT INTO token_transactions 
                (wallet_address, amount, type, reference_type, reference_id, description)
                VALUES ($1, $2, 'credit', 'membership_purchase', $3, $4)
            `, [wallet_address, buyingPowerAmount, order_id, `${pkg?.name || 'Membership'} purchase`]);
        } catch (txError) {
            console.log('⚠️ token_transactions table may not exist, skipping transaction log');
        }

        // Update or create member balance
        try {
            await pool.query(`
                INSERT INTO member_balances (wallet_address, balance, total_credited)
                VALUES ($1, $2, $2)
                ON CONFLICT (wallet_address) 
                DO UPDATE SET 
                    balance = member_balances.balance + $2,
                    total_credited = member_balances.total_credited + $2,
                    updated_at = NOW()
            `, [wallet_address, buyingPowerAmount]);
            console.log(`✅ Kea Euros credited: €${buyingPowerAmount} to ${wallet_address.slice(0, 10)}...`);
        } catch (balanceError) {
            console.log('⚠️ member_balances table may not exist, skipping balance update');
        }

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
                        package: package_key
                    }
                });

                await pool.query(
                    'UPDATE membership_purchases SET transfer_id = $1 WHERE id = $2',
                    [transfer.id, order_id]
                );

                console.log(`✅ Transfer created: ${transfer.id} → €${transferAmount.toFixed(2)} to connected account`);
            } catch (transferError) {
                console.error('❌ Transfer failed:', transferError.message);
            }
        }

        // Send confirmation email
        if (email) {
            try {
                await sendMembershipConfirmationEmail(email, wallet_address, pkg, buyingPowerAmount);
                console.log(`📧 Confirmation email sent to ${email}`);
            } catch (emailError) {
                console.error('⚠️ Failed to send confirmation email:', emailError.message);
            }
        }

        console.log(`✅ Payment processing complete for order ${order_id}\n`);

    } catch (error) {
        console.error('❌ Error handling membership payment success:', error);
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

// ============================================
// Email Functions
// ============================================
async function sendMembershipConfirmationEmail(email, wallet, pkg, buyingPower) {
    const packageName = pkg?.name || 'Membership';

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #ee9d2b;">Welcome to Kea Valley!</h1>
            <p>Your membership has been activated and your Kea Euros is ready to use.</p>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #333;">${packageName}</h3>
                <p style="font-size: 24px; color: #10b981; margin: 10px 0;"><strong>€${buyingPower.toLocaleString()}</strong> Kea Euros</p>
                <p style="color: #666;">Connected wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)}</p>
            </div>
            
            <p>You can now browse our marketplace and book premium services using your Kea Euros.</p>
            
            <a href="${process.env.APP_URL || 'https://keavalley.com'}/marketplace" style="display: inline-block; background: #ee9d2b; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Browse Marketplace</a>
            
            <p style="color: #666;">If you have any questions, please contact us at support@keavalley.com</p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">Kea Valley Private Members Club</p>
        </div>
    `;

    await sendEmail({
        to: email,
        subject: `Welcome to Kea Valley - ${packageName} Activated`,
        html
    });
}

async function sendAdminMembershipNotification(orderId, email, wallet, pkg, amount, buyingPower) {
    const packageName = pkg?.name || 'Membership';

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #ee9d2b;">New Membership Purchase!</h1>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${packageName}</h3>
                <p><strong>Order ID:</strong> ${orderId}</p>
                <p><strong>Customer:</strong> ${email}</p>
                <p><strong>Wallet:</strong> ${wallet}</p>
                <p><strong>Amount Paid:</strong> €${amount.toLocaleString()}</p>
                <p><strong>Kea Euros Granted:</strong> €${buyingPower.toLocaleString()}</p>
            </div>
            
            <a href="${process.env.ADMIN_URL || process.env.APP_URL || 'https://keavalley.com'}/admin/memberships/${orderId}" style="display: inline-block; background: #ee9d2b; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View in Admin</a>
        </div>
    `;

    if (process.env.ADMIN_EMAIL) {
        await sendEmail({
            to: process.env.ADMIN_EMAIL,
            subject: `[NEW MEMBERSHIP] ${packageName} - €${amount.toLocaleString()}`,
            html
        });
    }
}

module.exports = router;
