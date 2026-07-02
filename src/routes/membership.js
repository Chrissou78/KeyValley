// src/routes/membership.js
// VERSION: 2026-04-25 - Packages from DB + 90/10 split on NET + Email webhook
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
// ============================================
router.post('/mint-and-capture', async (req, res) => {
    const { paymentIntentId, orderId, walletAddress, packageId } = req.body;
    
    console.log('='.repeat(60));
    console.log('🔄 MINT-AND-CAPTURE START');
    console.log('='.repeat(60));
    console.log('📦 Input:', { paymentIntentId, orderId, walletAddress, packageId });
    
    try {
        // 1. Get the payment intent
        console.log('\n📍 STEP 1: Retrieving payment intent...');
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log('✅ Payment intent retrieved');
        console.log('   Status:', paymentIntent.status);
        console.log('   Amount:', paymentIntent.amount / 100, paymentIntent.currency?.toUpperCase());
        
        if (paymentIntent.status !== 'requires_capture') {
            console.log('❌ FAILED: Payment not ready for capture');
            return res.status(400).json({ 
                success: false, 
                error: 'Payment not ready for capture. Status: ' + paymentIntent.status 
            });
        }
        
        // 2. Get package details
        console.log('\n📍 STEP 2: Getting package details...');
        console.log('   Package ID:', packageId);
        const pkg = await getPackage(packageId);
        if (!pkg) {
            console.log('❌ FAILED: Package not found:', packageId);
            // Cancel the payment intent
            await stripe.paymentIntents.cancel(paymentIntentId);
            return res.status(404).json({ success: false, error: 'Package not found' });
        }
        console.log('✅ Package found:', pkg.name);
        console.log('   Price:', pkg.price);
        console.log('   Buying Power:', pkg.buyingPower);
        
        const buyingPowerAmount = parseFloat(pkg.buyingPower);
        const walletLower = walletAddress.toLowerCase();
        console.log('   Parsed buying power:', buyingPowerAmount);
        console.log('   Wallet (lowercase):', walletLower);
        
        // Get user email from metadata or order
        const userEmail = paymentIntent.metadata?.email || paymentIntent.receipt_email;
        console.log('   User email:', userEmail || 'NOT FOUND');
        
        // 3. MINT TOKENS FIRST
        console.log('\n📍 STEP 3: Minting tokens...');
        let mintTxHash = null;
        try {
            console.log('🪙 Minting', buyingPowerAmount, 'tokens to', walletLower);
            
            // Load ethers
            const { ethers } = require('ethers');
            
            // Check environment variables
            console.log('\n🔧 Environment check:');
            console.log('   POLYGON_RPC:', process.env.POLYGON_RPC ? '✅ Set' : '❌ MISSING');
            console.log('   PRIVATE_KEY:', process.env.PRIVATE_KEY ? '✅ Set (' + process.env.PRIVATE_KEY.slice(0, 6) + '...)' : '❌ MISSING');
            console.log('   TOKEN_ADDRESS_POLYGON:', process.env.TOKEN_ADDRESS_POLYGON || '❌ MISSING');
            
            if (!process.env.POLYGON_RPC) {
                throw new Error('POLYGON_RPC environment variable is missing');
            }
            if (!process.env.PRIVATE_KEY) {
                throw new Error('PRIVATE_KEY environment variable is missing');
            }
            if (!process.env.TOKEN_ADDRESS_POLYGON) {
                throw new Error('TOKEN_ADDRESS_POLYGON environment variable is missing');
            }
            
            console.log('\n🔗 Connecting to Polygon RPC...');
            const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
            
            // Test provider connection
            try {
                const network = await provider.getNetwork();
                console.log('✅ Connected to network:', network.name, '(chainId:', network.chainId.toString(), ')');
            } catch (networkError) {
                console.error('❌ Failed to connect to network:', networkError.message);
                throw new Error('Failed to connect to Polygon network: ' + networkError.message);
            }
            
            console.log('\n🔑 Loading minter wallet...');
            const minterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            console.log('✅ Minter wallet address:', minterWallet.address);
            
            // Check minter MATIC balance for gas
            const maticBalance = await provider.getBalance(minterWallet.address);
            const maticBalanceFormatted = ethers.formatEther(maticBalance);
            console.log('💰 Minter MATIC balance:', maticBalanceFormatted, 'MATIC');
            
            if (parseFloat(maticBalanceFormatted) < 0.01) {
                throw new Error('Minter wallet has insufficient MATIC for gas. Balance: ' + maticBalanceFormatted + ' MATIC');
            }
            
            console.log('\n📝 Creating token contract instance...');
            console.log('   Token address:', process.env.TOKEN_ADDRESS_POLYGON);
            const tokenContract = new ethers.Contract(
                process.env.TOKEN_ADDRESS_POLYGON,
                ['function mint(address to, uint256 amount) external'],
                minterWallet
            );
            console.log('✅ Token contract created');
            
            // Mint with proper decimals (assuming 18)
            console.log('\n🪙 Preparing mint transaction...');
            const mintAmount = ethers.parseUnits(buyingPowerAmount.toString(), 18);
            console.log('   Amount (human):', buyingPowerAmount);
            console.log('   Amount (wei):', mintAmount.toString());
            console.log('   To address:', walletAddress);
            
            console.log('\n📤 Sending mint transaction...');
            const tx = await tokenContract.mint(walletAddress, mintAmount);
            console.log('✅ Transaction sent!');
            console.log('   TX Hash:', tx.hash);
            
            console.log('⏳ Waiting for confirmation...');
            const receipt = await tx.wait();
            console.log('✅ Transaction confirmed!');
            console.log('   Block number:', receipt.blockNumber);
            console.log('   Gas used:', receipt.gasUsed?.toString());
            
            mintTxHash = receipt.hash;
            console.log('✅ MINTING SUCCESSFUL! TX:', mintTxHash);
            
        } catch (mintError) {
            console.error('\n❌ MINTING FAILED');
            console.error('   Error name:', mintError.name);
            console.error('   Error message:', mintError.message);
            console.error('   Error code:', mintError.code);
            if (mintError.reason) console.error('   Error reason:', mintError.reason);
            if (mintError.data) console.error('   Error data:', mintError.data);
            if (mintError.transaction) console.error('   Transaction:', mintError.transaction);
            console.error('   Full error:', JSON.stringify(mintError, Object.getOwnPropertyNames(mintError), 2));
            
            // CANCEL the payment - don't charge the user
            console.log('\n🚫 Cancelling payment intent...');
            await stripe.paymentIntents.cancel(paymentIntentId);
            console.log('✅ Payment cancelled');
            
            // Update order status
            await pool.query(
                `UPDATE membership_purchases SET status = 'mint_failed', error_message = $1 WHERE payment_intent_id = $2`,
                [mintError.message, paymentIntentId]
            );
            console.log('✅ Order status updated to mint_failed');
            
            return res.status(500).json({ 
                success: false, 
                error: 'Token minting failed. Your card was not charged.',
                details: mintError.message
            });
        }
        
        // 4. CAPTURE PAYMENT (only after successful mint)
        console.log('\n📍 STEP 4: Capturing payment...');
        const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
        console.log('✅ Payment captured!');
        console.log('   Status:', capturedIntent.status);
        console.log('   Amount received:', capturedIntent.amount_received / 100, capturedIntent.currency?.toUpperCase());
        
        // 5. Credit database balance
        console.log('\n📍 STEP 5: Crediting database balance...');
        console.log('   Wallet:', walletLower);
        console.log('   Amount:', buyingPowerAmount);
        await pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = member_balances.total_credited + $2,
                updated_at = NOW()
        `, [walletLower, buyingPowerAmount]);
        console.log('✅ Database balance credited');
        
        // 6. Calculate fees and update order
        console.log('\n📍 STEP 6: Calculating fees...');
        const amountReceived = capturedIntent.amount_received / 100;
        const paymentCurrency = (capturedIntent.currency || 'eur').toLowerCase();
        let stripeFee = estimateStripeFee(amountReceived);
        let feeSource = 'estimated';
        console.log('   Amount received:', amountReceived, paymentCurrency.toUpperCase());
        console.log('   Estimated Stripe fee:', stripeFee);

        // Try to get actual fee from Stripe
        try {
            if (capturedIntent.latest_charge) {
                console.log('   Fetching actual fee from charge:', capturedIntent.latest_charge);
                const charge = await stripe.charges.retrieve(capturedIntent.latest_charge);
                
                if (charge.balance_transaction) {
                    const balanceTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
                    
                    const balanceCurrency = (balanceTx.currency || 'eur').toLowerCase();
                    const exchangeRate = balanceTx.exchange_rate || 1;
                    
                    console.log('   Balance Transaction:', {
                        id: balanceTx.id,
                        currency: balanceCurrency.toUpperCase(),
                        amount: balanceTx.amount / 100,
                        fee: balanceTx.fee / 100,
                        net: balanceTx.net / 100,
                        exchange_rate: exchangeRate
                    });
                    
                    let actualFeeInBalanceCurrency = balanceTx.fee / 100;
                    let actualFeeInPaymentCurrency;
                    
                    if (balanceCurrency !== paymentCurrency && exchangeRate > 0) {
                        actualFeeInPaymentCurrency = actualFeeInBalanceCurrency / exchangeRate;
                        console.log('   Currency conversion:', actualFeeInBalanceCurrency, balanceCurrency.toUpperCase(), '→', actualFeeInPaymentCurrency.toFixed(2), paymentCurrency.toUpperCase());
                    } else {
                        actualFeeInPaymentCurrency = actualFeeInBalanceCurrency;
                    }
                    
                    const maxReasonableFee = amountReceived * 0.10;
                    const minReasonableFee = 0.25;
                    
                    if (actualFeeInPaymentCurrency >= minReasonableFee && actualFeeInPaymentCurrency <= maxReasonableFee) {
                        stripeFee = actualFeeInPaymentCurrency;
                        feeSource = 'actual';
                        console.log('   ✅ Using actual Stripe fee:', stripeFee.toFixed(2));
                    } else {
                        console.log('   ⚠️ Fee outside expected range, using estimate');
                    }
                }
            }
        } catch (e) {
            console.log('   ⚠️ Could not retrieve actual Stripe fee:', e.message);
        }
        
        const netAmount = amountReceived - stripeFee;
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const partnerAmount = netAmount - platformFee;
        
        console.log('   Fee summary:');
        console.log('     Stripe fee:', stripeFee.toFixed(2), '(' + feeSource + ')');
        console.log('     Net amount:', netAmount.toFixed(2));
        console.log('     Platform fee:', platformFee.toFixed(2), '(' + PLATFORM_FEE_PERCENT + '%)');
        console.log('     Partner amount:', partnerAmount.toFixed(2));
        
        // Update order with all details
        console.log('\n📍 Updating order in database...');
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
        console.log('✅ Order updated to completed');
        
        // 7. Transfer to connected account (if configured)
        console.log('\n📍 STEP 7: Partner transfer...');
        if (CONNECTED_ACCOUNT_ID && partnerAmount > 0) {
            console.log('   Connected account:', CONNECTED_ACCOUNT_ID);
            console.log('   Transfer amount:', partnerAmount.toFixed(2));
            try {
                await stripe.transfers.create({
                    amount: Math.round(partnerAmount * 100),
                    currency: 'eur',
                    destination: CONNECTED_ACCOUNT_ID,
                    transfer_group: orderId,
                    metadata: { order_id: orderId, package_id: packageId }
                });
                console.log('✅ Transfer to partner successful');
            } catch (e) {
                console.error('   ❌ Transfer failed:', e.message);
            }
        } else {
            console.log('   ⏭️ Skipping transfer (no connected account or zero amount)');
        }
        
        // 8. Send confirmation emails
        console.log('\n📍 STEP 8: Sending confirmation emails...');
        
        // Email to buyer (receipt)
        if (userEmail) {
            try {
                console.log('   Sending receipt to buyer:', userEmail);
                await emailService.sendMembershipReceiptToBuyer({
                    userEmail: userEmail,
                    packageName: pkg.name,
                    amountPaid: pkg.price,
                    buyingPower: buyingPowerAmount,
                    orderNumber: orderId,
                    walletAddress: walletAddress
                });
                console.log('   ✅ Receipt email sent to buyer');
            } catch (emailError) {
                console.error('   ⚠️ Failed to send buyer email:', emailError.message);
            }
        } else {
            console.log('   ⏭️ Skipping buyer email (no email address)');
        }
        
        // Email to owner (notification with split details)
        try {
            console.log('   Sending notification to owner...');
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
            console.log('   ✅ Notification email sent to owner');
        } catch (emailError) {
            console.error('   ⚠️ Failed to send owner email:', emailError.message);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ MINT-AND-CAPTURE COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60));
        console.log('   Order ID:', orderId);
        console.log('   Mint TX:', mintTxHash);
        console.log('   Buying Power:', buyingPowerAmount);
        console.log('='.repeat(60) + '\n');
        
        res.json({
            success: true,
            order_id: orderId,
            mint_tx_hash: mintTxHash,
            buying_power: buyingPowerAmount,
            message: 'Tokens minted and payment captured successfully'
        });
        
    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ MINT-AND-CAPTURE FATAL ERROR');
        console.error('='.repeat(60));
        console.error('   Error name:', error.name);
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);
        console.error('='.repeat(60) + '\n');
        
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
