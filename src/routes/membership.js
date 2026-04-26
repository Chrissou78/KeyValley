// src/routes/membership.js
// VERSION: 2026-04-25 - Packages from DB + 90/10 split on NET + Email webhook
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db-postgres');
const emailService = require('../services/email-webhook');

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
            SELECT id, name, description, price, currency, buying_power, bonus,
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

// ============================================
// POST /api/membership/mint-and-capture
// ============================================
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
        
        // Get user email from metadata or order
        const userEmail = paymentIntent.metadata?.email || paymentIntent.receipt_email;
        
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
        
        // 8. Send confirmation emails
        console.log('📧 Sending confirmation emails...');
        
        // Email to buyer (receipt)
        if (userEmail) {
            try {
                await emailService.sendMembershipReceiptToBuyer({
                    userEmail: userEmail,
                    packageName: pkg.name,
                    amountPaid: pkg.price,
                    buyingPower: buyingPowerAmount,
                    orderNumber: orderId,
                    walletAddress: walletAddress
                });
                console.log('✅ Receipt email sent to buyer:', userEmail);
            } catch (emailError) {
                console.error('⚠️ Failed to send buyer email:', emailError.message);
            }
        }
        
        // Email to owner (notification with split details)
        try {
            await emailService.sendMembershipNotificationToOwner({
                userEmail: userEmail,
                packageName: pkg.name,
                amountPaid: pkg.price,
                buyingPower: buyingPowerAmount,
                orderNumber: orderId,
                walletAddress: walletAddress,
                stripeFee: stripeFee,
                netAmount: netAmount,
                platformFee: platformFee,
                partnerAmount: partnerAmount
            });
            console.log('✅ Notification email sent to owner');
        } catch (emailError) {
            console.error('⚠️ Failed to send owner email:', emailError.message);
        }
        
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
// Handle Successful Payment - Skip if already processed by mint-and-capture
// ============================================
async function handleMembershipPaymentSuccess(paymentIntent) {
    console.log(`\n💳 Webhook received for: ${paymentIntent.id}`);
    
    try {
        // Check if already processed by mint-and-capture
        const existingCheck = await pool.query(
            'SELECT status FROM membership_purchases WHERE payment_intent_id = $1',
            [paymentIntent.id]
        );
        
        if (existingCheck.rows.length > 0 && existingCheck.rows[0].status === 'completed') {
            console.log('⚠️ Already processed by mint-and-capture, skipping webhook');
            return;
        }
        
        // If not completed, this is a fallback - but mint-and-capture should handle everything
        console.log('⚠️ Order not completed by mint-and-capture, webhook will not process');
        
    } catch (error) {
        console.error('❌ Error in webhook handler:', error);
    }
}

async function handleMembershipPaymentFailed(paymentIntent) {
    const { order_id } = paymentIntent.metadata;

    console.log(`❌ Payment failed for order ${order_id}: ${paymentIntent.last_payment_error?.message}`);

    try {
        await pool.query(
            "UPDATE membership_purchases SET status = 'failed', error_message = $1 WHERE id = $2",
            [paymentIntent.last_payment_error?.message || 'Payment failed', order_id]
        );
    } catch (error) {
        console.error('Error handling failed membership payment:', error);
    }
}

module.exports = router;
