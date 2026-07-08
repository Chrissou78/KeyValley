// src/routes/membership.js
// VERSION: 2026-07-08 - With step timing for frontend debug panel
require('dotenv').config();
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db-postgres');
const emailService = require('../services/email-webhook');

// Debug: Check env vars at load time
console.log('🔧 MEMBERSHIP ROUTE ENV CHECK AT LOAD:');
console.log('   POLYGON_RPC:', process.env.POLYGON_RPC ? '✅ Set' : '❌ Missing');
console.log('   PRIVATE_KEY:', process.env.PRIVATE_KEY ? '✅ Set' : '❌ Missing');
console.log('   TOKEN_ADDRESS_POLYGON:', process.env.TOKEN_ADDRESS_POLYGON ? '✅ Set' : '❌ Missing');

const PLATFORM_FEE_PERCENT = 10; // 10% platform fee on NET amount (after Stripe fees)
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

console.log('✅ Membership routes initialized');
console.log(`   Connected Account: ${CONNECTED_ACCOUNT_ID || 'NOT CONFIGURED'}`);
console.log(`   Platform Fee: ${PLATFORM_FEE_PERCENT}% of NET (after Stripe fees)`);

// ============================================
// Helper: Get package from database
// ============================================

function estimateStripeFee(amount) {
    return amount * 0.029 + 0.25;
}

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
// With detailed step timing for frontend debug
// ============================================
router.post('/mint-and-capture', async (req, res) => {
    const { paymentIntentId, orderId, walletAddress, packageId } = req.body;
    
    // Timing tracker
    const startTime = Date.now();
    const stepTiming = {
        total_start: startTime,
        steps: {}
    };
    
    const logStep = (stepNum, stepName, status = 'start') => {
        const now = Date.now();
        const elapsed = now - startTime;
        const key = `step_${stepNum}_${stepName}`;
        
        if (status === 'start') {
            stepTiming.steps[key] = { start: elapsed };
            console.log(`\n📍 [${elapsed}ms] STEP ${stepNum}: ${stepName}...`);
        } else {
            if (stepTiming.steps[key]) {
                stepTiming.steps[key].end = elapsed;
                stepTiming.steps[key].duration = elapsed - stepTiming.steps[key].start;
            }
            const icon = status === 'complete' ? '✅' : '❌';
            console.log(`${icon} [${elapsed}ms] STEP ${stepNum}: ${stepName} ${status}`);
        }
    };
    
    console.log('\n' + '='.repeat(60));
    console.log(`🔄 [${new Date().toISOString()}] MINT-AND-CAPTURE START`);
    console.log('='.repeat(60));
    console.log('📦 Input:', { paymentIntentId, orderId, walletAddress, packageId });
    
    // Response data that will be built up through the process
    let responseData = {
        success: false,
        order_id: orderId,
        mint_tx_hash: null,
        buying_power: null,
        processing_time_ms: null,
        step_timing: null,
        current_step: 0,
        error: null
    };
    
    try {
        // ========================================
        // STEP 1: Retrieve Payment Intent
        // ========================================
        logStep(1, 'retrieve_payment');
        responseData.current_step = 1;
        
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        console.log('   Status:', paymentIntent.status);
        console.log('   Amount:', paymentIntent.amount / 100, paymentIntent.currency?.toUpperCase());
        
        if (paymentIntent.status !== 'requires_capture') {
            logStep(1, 'retrieve_payment', 'failed');
            responseData.error = `Payment not ready for capture. Status: ${paymentIntent.status}`;
            responseData.processing_time_ms = Date.now() - startTime;
            return res.status(400).json(responseData);
        }
        
        logStep(1, 'retrieve_payment', 'complete');
        
        // ========================================
        // STEP 2: Get Package Details
        // ========================================
        logStep(2, 'get_package');
        responseData.current_step = 2;
        
        const pkg = await getPackage(packageId);
        
        if (!pkg) {
            logStep(2, 'get_package', 'failed');
            console.log('   Package not found:', packageId);
            await stripe.paymentIntents.cancel(paymentIntentId);
            responseData.error = 'Package not found';
            responseData.processing_time_ms = Date.now() - startTime;
            return res.status(404).json(responseData);
        }
        
        console.log('   Package:', pkg.name);
        console.log('   Price:', pkg.price);
        console.log('   Buying Power:', pkg.buyingPower);
        
        const buyingPowerAmount = parseFloat(pkg.buyingPower);
        const walletLower = walletAddress.toLowerCase();
        const userEmail = paymentIntent.metadata?.email || paymentIntent.receipt_email;
        
        responseData.buying_power = buyingPowerAmount;
        logStep(2, 'get_package', 'complete');
        
        // ========================================
        // STEP 3: Mint Tokens (On-Chain)
        // ========================================
        logStep(3, 'mint_tokens');
        responseData.current_step = 3;
        
        let mintTxHash = null;
        let txBroadcastTime = null;
        let txConfirmTime = null;
        
        try {
            const { ethers } = require('ethers');
            
            // Environment check
            console.log('   🔧 Environment check:');
            console.log('      POLYGON_RPC:', process.env.POLYGON_RPC ? '✅' : '❌');
            console.log('      PRIVATE_KEY:', process.env.PRIVATE_KEY ? '✅' : '❌');
            console.log('      TOKEN_ADDRESS:', process.env.TOKEN_ADDRESS_POLYGON ? '✅' : '❌');
            
            if (!process.env.POLYGON_RPC) throw new Error('POLYGON_RPC missing');
            if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY missing');
            if (!process.env.TOKEN_ADDRESS_POLYGON) throw new Error('TOKEN_ADDRESS_POLYGON missing');
            
            // Connect to provider
            console.log('   🔗 Connecting to Polygon...');
            const providerStart = Date.now();
            const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
            
            const network = await provider.getNetwork();
            console.log(`   ✅ Connected to ${network.name} (${network.chainId}) in ${Date.now() - providerStart}ms`);
            
            // Setup wallet
            const minterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            console.log('   🔑 Minter:', minterWallet.address);
            
            // Check gas balance
            const maticBalance = await provider.getBalance(minterWallet.address);
            const maticFormatted = ethers.formatEther(maticBalance);
            console.log('   💰 MATIC balance:', maticFormatted);
            
            if (parseFloat(maticFormatted) < 0.01) {
                throw new Error(`Insufficient MATIC for gas: ${maticFormatted}`);
            }
            
            // Create contract instance
            const tokenContract = new ethers.Contract(
                process.env.TOKEN_ADDRESS_POLYGON,
                ['function mint(address to, uint256 amount) external'],
                minterWallet
            );
            
            // Prepare mint amount
            const mintAmount = ethers.parseUnits(buyingPowerAmount.toString(), 18);
            console.log('   🪙 Minting', buyingPowerAmount, 'tokens to', walletAddress);
            
            // Send transaction
            console.log('   📤 Broadcasting transaction...');
            const txStart = Date.now();
            const tx = await tokenContract.mint(walletAddress, mintAmount);
            txBroadcastTime = Date.now() - txStart;
            
            // TX is now broadcast - we have the hash!
            mintTxHash = tx.hash;
            responseData.mint_tx_hash = mintTxHash;
            
            console.log(`   ✅ TX BROADCAST in ${txBroadcastTime}ms`);
            console.log(`   📋 TX Hash: ${mintTxHash}`);
            console.log('   ⏳ Waiting for confirmation...');
            
            stepTiming.steps['step_3_tx_broadcast'] = { 
                hash: mintTxHash, 
                duration: txBroadcastTime 
            };
            
            // Wait for confirmation
            const confirmStart = Date.now();
            const receipt = await tx.wait(1); // Wait for 1 confirmation
            txConfirmTime = Date.now() - confirmStart;
            
            console.log(`   ✅ TX CONFIRMED in ${txConfirmTime}ms`);
            console.log(`   📦 Block: ${receipt.blockNumber}`);
            console.log(`   ⛽ Gas used: ${receipt.gasUsed?.toString()}`);
            
            stepTiming.steps['step_3_tx_confirm'] = { 
                block: receipt.blockNumber,
                gasUsed: receipt.gasUsed?.toString(),
                duration: txConfirmTime 
            };
            
            mintTxHash = receipt.hash || tx.hash;
            responseData.mint_tx_hash = mintTxHash;
            
            logStep(3, 'mint_tokens', 'complete');
            
        } catch (mintError) {
            logStep(3, 'mint_tokens', 'failed');
            console.error('   ❌ MINT ERROR:', mintError.message);
            
            // Cancel payment - don't charge user
            console.log('   🚫 Cancelling payment...');
            try {
                await stripe.paymentIntents.cancel(paymentIntentId);
            } catch (cancelError) {
                console.error('   ⚠️ Could not cancel payment:', cancelError.message);
            }
            
            // Update order
            await pool.query(
                `UPDATE membership_purchases SET status = 'mint_failed', error_message = $1 WHERE payment_intent_id = $2`,
                [mintError.message, paymentIntentId]
            );
            
            responseData.error = 'Token minting failed. Your card was not charged.';
            responseData.error_details = mintError.message;
            responseData.processing_time_ms = Date.now() - startTime;
            responseData.step_timing = stepTiming;
            
            return res.status(500).json(responseData);
        }
        
        // ========================================
        // STEP 4: Capture Payment
        // ========================================
        logStep(4, 'capture_payment');
        responseData.current_step = 4;
        
        const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
        
        console.log('   Status:', capturedIntent.status);
        console.log('   Amount:', capturedIntent.amount_received / 100, capturedIntent.currency?.toUpperCase());
        
        logStep(4, 'capture_payment', 'complete');
        
        // ========================================
        // STEP 5: Update Database
        // ========================================
        logStep(5, 'update_database');
        responseData.current_step = 5;
        
        // Credit balance
        console.log('   💳 Crediting balance:', buyingPowerAmount, 'to', walletLower);
        await pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = member_balances.total_credited + $2,
                updated_at = NOW()
        `, [walletLower, buyingPowerAmount]);
        
        // Calculate fees
        const amountReceived = capturedIntent.amount_received / 100;
        let stripeFee = estimateStripeFee(amountReceived);
        
        // Try to get actual fee
        try {
            if (capturedIntent.latest_charge) {
                const charge = await stripe.charges.retrieve(capturedIntent.latest_charge);
                if (charge.balance_transaction) {
                    const balanceTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
                    const actualFee = balanceTx.fee / 100;
                    const maxFee = amountReceived * 0.10;
                    if (actualFee >= 0.25 && actualFee <= maxFee) {
                        stripeFee = actualFee;
                    }
                }
            }
        } catch (e) {
            console.log('   ⚠️ Could not get actual fee, using estimate');
        }
        
        const netAmount = amountReceived - stripeFee;
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const partnerAmount = netAmount - platformFee;
        
        console.log('   📊 Fees: Stripe €' + stripeFee.toFixed(2) + ', Platform €' + platformFee.toFixed(2) + ', Partner €' + partnerAmount.toFixed(2));
        
        // Update order
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
        
        logStep(5, 'update_database', 'complete');
        
        // ========================================
        // STEP 6: Partner Transfer (if configured)
        // ========================================
        logStep(6, 'partner_transfer');
        
        if (CONNECTED_ACCOUNT_ID && partnerAmount > 0) {
            try {
                await stripe.transfers.create({
                    amount: Math.round(partnerAmount * 100),
                    currency: 'eur',
                    destination: CONNECTED_ACCOUNT_ID,
                    transfer_group: orderId,
                    metadata: { order_id: orderId, package_id: packageId }
                });
                console.log('   ✅ Transfer successful: €' + partnerAmount.toFixed(2));
                logStep(6, 'partner_transfer', 'complete');
            } catch (e) {
                console.error('   ⚠️ Transfer failed:', e.message);
                logStep(6, 'partner_transfer', 'failed');
            }
        } else {
            console.log('   ⏭️ Skipped (no connected account)');
            logStep(6, 'partner_transfer', 'complete');
        }
        
        // ========================================
        // STEP 7: Send Emails
        // ========================================
        logStep(7, 'send_emails');
        
        // Email to buyer
        if (userEmail) {
            try {
                await emailService.sendMembershipReceiptToBuyer({
                    userEmail,
                    packageName: pkg.name,
                    amountPaid: pkg.price,
                    buyingPower: buyingPowerAmount,
                    orderNumber: orderId,
                    walletAddress
                });
                console.log('   ✅ Buyer receipt sent');
            } catch (e) {
                console.log('   ⚠️ Buyer email failed:', e.message);
            }
        }
        
        // Email to owner
        try {
            await emailService.sendMembershipNotificationToOwner({
                userEmail,
                packageName: pkg.name,
                amountPaid: pkg.price,
                buyingPower: buyingPowerAmount,
                orderNumber: orderId,
                walletAddress,
                stripeFee,
                netAmount,
                platformFee,
                partnerAmount
            });
            console.log('   ✅ Owner notification sent');
        } catch (e) {
            console.log('   ⚠️ Owner email failed:', e.message);
        }
        
        logStep(7, 'send_emails', 'complete');
        
        // ========================================
        // COMPLETE
        // ========================================
        const totalTime = Date.now() - startTime;
        stepTiming.total_duration = totalTime;
        
        console.log('\n' + '='.repeat(60));
        console.log(`✅ [${totalTime}ms] MINT-AND-CAPTURE COMPLETED`);
        console.log('='.repeat(60));
        console.log('   Order:', orderId);
        console.log('   TX:', mintTxHash);
        console.log('   Buying Power:', buyingPowerAmount);
        console.log('   Total Time:', totalTime + 'ms');
        console.log('='.repeat(60) + '\n');
        
        responseData.success = true;
        responseData.processing_time_ms = totalTime;
        responseData.step_timing = stepTiming;
        responseData.message = 'Tokens minted and payment captured successfully';
        
        res.json(responseData);
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        
        console.error('\n' + '='.repeat(60));
        console.error(`❌ [${totalTime}ms] MINT-AND-CAPTURE FATAL ERROR`);
        console.error('='.repeat(60));
        console.error('   Error:', error.message);
        console.error('   Stack:', error.stack);
        console.error('='.repeat(60) + '\n');
        
        responseData.error = error.message;
        responseData.processing_time_ms = totalTime;
        responseData.step_timing = stepTiming;
        
        res.status(500).json(responseData);
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
// GET /api/membership/debug-env - Debug endpoint (remove in production)
// ============================================
router.get('/debug-env', (req, res) => {
    res.json({
        POLYGON_RPC: process.env.POLYGON_RPC ? '✅ Set (' + process.env.POLYGON_RPC.substring(0, 30) + '...)' : '❌ Missing',
        PRIVATE_KEY: process.env.PRIVATE_KEY ? '✅ Set (' + process.env.PRIVATE_KEY.substring(0, 6) + '...)' : '❌ Missing',
        TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON || '❌ Missing',
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? '✅ Set' : '❌ Missing',
        STRIPE_CONNECTED_ACCOUNT_ID: CONNECTED_ACCOUNT_ID || 'Not configured',
        NODE_ENV: process.env.NODE_ENV || 'development'
    });
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
