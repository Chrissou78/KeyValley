// src/routes/membership.js
// VERSION: 2026-07-08 v3 - Manual TX polling (fixes tx.wait() hanging on Alchemy)
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

const PLATFORM_FEE_PERCENT = 10;
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

// Timeout settings
const TX_POLL_TIMEOUT_MS = 30000; // 30 seconds max for polling confirmation
const TX_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

console.log('✅ Membership routes initialized');
console.log(`   Connected Account: ${CONNECTED_ACCOUNT_ID || 'NOT CONFIGURED'}`);
console.log(`   Platform Fee: ${PLATFORM_FEE_PERCENT}% of NET`);
console.log(`   TX Poll Timeout: ${TX_POLL_TIMEOUT_MS}ms`);

// ============================================
// Helper: Sleep
// ============================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Helper: Timeout wrapper
// ============================================
function withTimeout(promise, ms, operation) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
        )
    ]);
}

// ============================================
// Helper: Manual TX polling (replaces tx.wait())
// ============================================
async function pollForReceipt(provider, txHash, maxWaitMs = TX_POLL_TIMEOUT_MS, intervalMs = TX_POLL_INTERVAL_MS) {
    const startTime = Date.now();
    let attempts = 0;
    
    console.log(`   ⏳ Polling for TX receipt: ${txHash}`);
    console.log(`      Max wait: ${maxWaitMs}ms, Interval: ${intervalMs}ms`);
    
    while (Date.now() - startTime < maxWaitMs) {
        attempts++;
        const elapsed = Date.now() - startTime;
        
        try {
            const receipt = await provider.getTransactionReceipt(txHash);
            
            if (receipt !== null) {
                console.log(`   ✅ Receipt found on attempt ${attempts} (${elapsed}ms)`);
                console.log(`      Block: ${receipt.blockNumber}, Status: ${receipt.status}`);
                return {
                    success: true,
                    confirmed: true,
                    receipt,
                    attempts,
                    elapsedMs: elapsed
                };
            }
            
            console.log(`   ⏳ Attempt ${attempts}: No receipt yet (${elapsed}ms)`);
            
        } catch (pollError) {
            console.log(`   ⚠️ Poll attempt ${attempts} error: ${pollError.message}`);
        }
        
        // Wait before next poll
        await sleep(intervalMs);
    }
    
    // Timeout reached - TX was broadcast but we couldn't confirm
    const elapsed = Date.now() - startTime;
    console.log(`   ⚠️ Polling timeout after ${attempts} attempts (${elapsed}ms)`);
    console.log(`   ⚠️ TX was broadcast - likely confirmed on-chain`);
    console.log(`   🔗 Verify: https://polygonscan.com/tx/${txHash}`);
    
    return {
        success: true, // TX was broadcast successfully
        confirmed: false, // But we couldn't get receipt
        receipt: null,
        attempts,
        elapsedMs: elapsed,
        reason: 'poll_timeout'
    };
}

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
// GET /api/membership/verify-connect
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
                payouts_enabled: account.payouts_enabled
            },
            splitConfig: {
                platformFeePercent: PLATFORM_FEE_PERCENT,
                connectedAccountPercent: 100 - PLATFORM_FEE_PERCENT
            }
        });
    } catch (error) {
        console.error('Error verifying connected account:', error);
        res.json({ success: false, configured: true, error: error.message });
    }
});

// ============================================
// POST /api/membership/mint-and-capture
// With manual polling instead of tx.wait()
// ============================================
router.post('/mint-and-capture', async (req, res) => {
    const { paymentIntentId, orderId, walletAddress, packageId } = req.body;
    
    const startTime = Date.now();
    const stepTiming = { steps: {} };
    const serverLogs = []; // NEW: Collect logs for frontend
    
    const log = (msg) => {
        const elapsed = Date.now() - startTime;
        const entry = `[${elapsed}ms] ${msg}`;
        console.log(entry);
        serverLogs.push(entry); // NEW: Store log
    };
    
    const markStep = (step, data = {}) => {
        stepTiming.steps[step] = { time: Date.now() - startTime, ...data };
    };
    
    log('═'.repeat(60));
    log('🔄 MINT-AND-CAPTURE START (v3 - Manual Polling)');
    log('═'.repeat(60));
    log(`   PaymentIntent: ${paymentIntentId}`);
    log(`   Order: ${orderId}`);
    log(`   Wallet: ${walletAddress}`);
    log(`   Package: ${packageId}`);
    
    let responseData = {
        success: false,
        order_id: orderId,
        mint_tx_hash: null,
        buying_power: null,
        processing_time_ms: null,
        step_timing: stepTiming,
        tx_confirmed: false,
        server_logs: serverLogs,
        error: null
    };
    
    let provider = null;
    
    try {
        // ========================================
        // STEP 1: Retrieve Payment Intent
        // ========================================
        markStep('1_start');
        log('📍 STEP 1: Retrieving payment intent...');
        
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        markStep('1_end', { status: paymentIntent.status });
        
        log(`   Status: ${paymentIntent.status}`);
        log(`   Amount: €${paymentIntent.amount / 100}`);
        
        // Handle already-captured payments gracefully
        if (paymentIntent.status === 'succeeded') {
            log('⚠️ Payment already captured - checking if mint completed...');
            
            const existingOrder = await pool.query(
                `SELECT status, metadata->>'mint_tx_hash' as tx_hash FROM membership_purchases WHERE payment_intent_id = $1`,
                [paymentIntentId]
            );
            
            if (existingOrder.rows.length > 0 && existingOrder.rows[0].status === 'completed') {
                log('✅ Order already completed, returning existing data');
                responseData.success = true;
                responseData.mint_tx_hash = existingOrder.rows[0].tx_hash;
                responseData.message = 'Order already processed';
                responseData.processing_time_ms = Date.now() - startTime;
                return res.json(responseData);
            }
            
            log('⚠️ Payment captured but order not completed - continuing to complete...');
        } else if (paymentIntent.status !== 'requires_capture') {
            log(`❌ Invalid payment status: ${paymentIntent.status}`);
            responseData.error = `Payment not ready. Status: ${paymentIntent.status}`;
            responseData.processing_time_ms = Date.now() - startTime;
            return res.status(400).json(responseData);
        }
        
        // ========================================
        // STEP 2: Get Package Details
        // ========================================
        markStep('2_start');
        log('📍 STEP 2: Getting package...');
        
        const pkg = await getPackage(packageId);
        
        if (!pkg) {
            log(`❌ Package not found: ${packageId}`);
            if (paymentIntent.status === 'requires_capture') {
                await stripe.paymentIntents.cancel(paymentIntentId);
            }
            responseData.error = 'Package not found';
            responseData.processing_time_ms = Date.now() - startTime;
            return res.status(404).json(responseData);
        }
        
        markStep('2_end', { name: pkg.name, price: pkg.price });
        log(`   Package: ${pkg.name}, €${pkg.price}, ${pkg.buyingPower} Kea€`);
        
        const buyingPowerAmount = parseFloat(pkg.buyingPower);
        const walletLower = walletAddress.toLowerCase();
        const userEmail = paymentIntent.metadata?.email || paymentIntent.receipt_email;
        
        responseData.buying_power = buyingPowerAmount;
        
        // ========================================
        // STEP 3: Mint Tokens (with manual polling)
        // ========================================
        markStep('3_start');
        log('📍 STEP 3: Minting tokens...');
        
        let mintTxHash = null;
        let txConfirmed = false;
        
        try {
            const { ethers } = require('ethers');
            
            // Quick env check
            if (!process.env.POLYGON_RPC || !process.env.PRIVATE_KEY || !process.env.TOKEN_ADDRESS_POLYGON) {
                throw new Error('Missing environment variables for minting');
            }
            
            log('   🔗 Connecting to Polygon...');
            markStep('3_provider_start');
            
            provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
            
            // Test connection with timeout
            const blockNumber = await withTimeout(
                provider.getBlockNumber(),
                10000,
                'Get block number'
            );
            markStep('3_provider_connected', { blockNumber });
            log(`   ✅ Connected, current block: ${blockNumber}`);
            
            // Setup wallet
            const minterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            log(`   🔑 Minter: ${minterWallet.address}`);
            
            // Check MATIC balance
            markStep('3_balance_start');
            const maticBalance = await withTimeout(
                provider.getBalance(minterWallet.address),
                10000,
                'Balance check'
            );
            const maticFormatted = ethers.formatEther(maticBalance);
            markStep('3_balance_end', { matic: maticFormatted });
            log(`   💰 MATIC: ${maticFormatted}`);
            
            if (parseFloat(maticFormatted) < 0.005) {
                throw new Error(`Low MATIC: ${maticFormatted}`);
            }
            
            // Create contract
            const tokenContract = new ethers.Contract(
                process.env.TOKEN_ADDRESS_POLYGON,
                ['function mint(address to, uint256 amount) external'],
                minterWallet
            );
            
            const mintAmount = ethers.parseUnits(buyingPowerAmount.toString(), 18);
            log(`   🪙 Minting ${buyingPowerAmount} tokens to ${walletAddress}`);
            
            // Send transaction with timeout
            markStep('3_tx_send_start');
            log('   📤 Sending transaction...');
            
            const tx = await withTimeout(
                tokenContract.mint(walletAddress, mintAmount),
                30000,
                'Transaction send'
            );
            
            mintTxHash = tx.hash;
            responseData.mint_tx_hash = mintTxHash;
            markStep('3_tx_broadcast', { hash: mintTxHash });
            log(`   ✅ TX BROADCAST: ${mintTxHash}`);
            log(`   🔗 https://polygonscan.com/tx/${mintTxHash}`);
            
            // Poll for confirmation (instead of tx.wait())
            markStep('3_poll_start');
            const pollResult = await pollForReceipt(provider, mintTxHash, TX_POLL_TIMEOUT_MS, TX_POLL_INTERVAL_MS);
            
            markStep('3_poll_end', {
                confirmed: pollResult.confirmed,
                attempts: pollResult.attempts,
                elapsedMs: pollResult.elapsedMs,
                block: pollResult.receipt?.blockNumber || null
            });
            
            if (pollResult.confirmed && pollResult.receipt) {
                log(`   ✅ TX CONFIRMED in block ${pollResult.receipt.blockNumber}`);
                
                if (pollResult.receipt.status === 0) {
                    throw new Error('Transaction reverted on-chain');
                }
                
                txConfirmed = true;
                mintTxHash = pollResult.receipt.hash || mintTxHash;
            } else {
                log('   ⚠️ Could not confirm TX, but it was broadcast successfully');
                log('   ⚠️ Continuing with payment capture (TX likely succeeded)');
                txConfirmed = false;
            }
            
            responseData.mint_tx_hash = mintTxHash;
            responseData.tx_confirmed = txConfirmed;
            markStep('3_mint_complete', { confirmed: txConfirmed });
            
        } catch (mintError) {
            markStep('3_mint_failed', { error: mintError.message });
            log(`   ❌ MINT FAILED: ${mintError.message}`);
            
            // If we have a TX hash, the mint might have succeeded
            if (mintTxHash) {
                log(`   ⚠️ TX was broadcast (${mintTxHash}) - mint may have succeeded`);
                log('   ⚠️ Will NOT cancel payment - manual verification needed');
                
                await pool.query(
                    `UPDATE membership_purchases SET status = 'mint_pending_verification', 
                     metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{mint_tx_hash}', $1::jsonb),
                     error_message = $2 WHERE payment_intent_id = $3`,
                    [JSON.stringify(mintTxHash), mintError.message, paymentIntentId]
                );
                
                responseData.error = 'Minting may have succeeded but confirmation failed. TX: ' + mintTxHash;
                responseData.processing_time_ms = Date.now() - startTime;
                return res.status(202).json(responseData);
            }
            
            // No TX hash - mint definitely failed, cancel payment
            if (paymentIntent.status === 'requires_capture') {
                log('   🚫 Cancelling payment...');
                try {
                    await stripe.paymentIntents.cancel(paymentIntentId);
                    log('   ✅ Payment cancelled');
                } catch (cancelErr) {
                    log(`   ⚠️ Could not cancel: ${cancelErr.message}`);
                }
            }
            
            await pool.query(
                `UPDATE membership_purchases SET status = 'mint_failed', error_message = $1 WHERE payment_intent_id = $2`,
                [mintError.message, paymentIntentId]
            );
            
            responseData.error = 'Minting failed. Your card was not charged.';
            responseData.error_details = mintError.message;
            responseData.processing_time_ms = Date.now() - startTime;
            return res.status(500).json(responseData);
        }
        
        // ========================================
        // STEP 4: Capture Payment
        // ========================================
        markStep('4_start');
        log('📍 STEP 4: Capturing payment...');

        let capturedIntent;
        let actualStripeFee = null;

        if (paymentIntent.status === 'requires_capture') {
            capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
            log(`   ✅ Captured: €${capturedIntent.amount_received / 100}`);
        } else {
            capturedIntent = paymentIntent;
            log('   ⚠️ Already captured, using existing data');
        }

        // Get ACTUAL Stripe fee from the charge
        const amountReceived = capturedIntent.amount_received / 100;

        if (capturedIntent.latest_charge) {
            try {
                const charge = await stripe.charges.retrieve(capturedIntent.latest_charge);
                if (charge.balance_transaction) {
                    const balanceTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
                    log(`📋 Balance TX raw: ${JSON.stringify(balanceTx)}`);
                    actualStripeFee = balanceTx.fee / 100;
                    log(`   💳 Actual Stripe fee: €${actualStripeFee.toFixed(2)}`);
                }
            } catch (e) {
                log(`   ⚠️ Could not get actual fee: ${e.message}`);
            }
        }

        // Use actual fee or estimate as fallback
        const stripeFee = actualStripeFee !== null ? actualStripeFee : estimateStripeFee(amountReceived);
        const netAmount = amountReceived - stripeFee;
        const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
        const partnerAmount = netAmount - platformFee;

        log(`   📊 Gross: €${amountReceived.toFixed(2)}`);
        log(`   📊 Stripe fee: €${stripeFee.toFixed(2)}${actualStripeFee !== null ? ' (actual)' : ' (estimated)'}`);
        log(`   📊 Net: €${netAmount.toFixed(2)}`);
        log(`   📊 Platform (${PLATFORM_FEE_PERCENT}%): €${platformFee.toFixed(2)}`);
        log(`   📊 Partner: €${partnerAmount.toFixed(2)}`);

        markStep('4_end', { 
            amount: amountReceived, 
            stripe_fee: stripeFee, 
            net: netAmount,
            platform: platformFee,
            partner: partnerAmount
        });

        // ========================================
        // STEP 5: Update Database
        // ========================================
        markStep('5_start');
        log('📍 STEP 5: Updating database...');

        // Credit balance
        await pool.query(`
            INSERT INTO member_balances (wallet_address, balance, total_credited)
            VALUES ($1, $2, $2)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET 
                balance = member_balances.balance + $2,
                total_credited = member_balances.total_credited + $2,
                updated_at = NOW()
        `, [walletLower, buyingPowerAmount]);
        log(`   ✅ Credited ${buyingPowerAmount} Kea€ to ${walletLower}`);

        // Update order
        await pool.query(`
            UPDATE membership_purchases 
            SET status = 'completed',
                stripe_fee = $1,
                net_amount = $2,
                platform_fee = $3,
                partner_amount = $4,
                metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{mint_tx_hash}', $5::jsonb)
            WHERE payment_intent_id = $6
        `, [stripeFee, netAmount, platformFee, partnerAmount, JSON.stringify(mintTxHash), paymentIntentId]);

        markStep('5_end');
        log('   ✅ Order updated');

        // ========================================
        // STEP 6: Partner Transfer
        // ========================================
        markStep('6_start');
        log('📍 STEP 6: Partner transfer...');

        if (CONNECTED_ACCOUNT_ID && partnerAmount > 0.50) {
            try {
                // Check available balance first
                const balance = await stripe.balance.retrieve();
                const availableEur = balance.available.find(b => b.currency === 'eur');
                const availableAmount = availableEur ? availableEur.amount / 100 : 0;
                
                log(`   💰 Available balance: €${availableAmount.toFixed(2)}`);
                
                if (availableAmount >= partnerAmount) {
                    await stripe.transfers.create({
                        amount: Math.round(partnerAmount * 100),
                        currency: 'eur',
                        destination: CONNECTED_ACCOUNT_ID,
                        transfer_group: orderId,
                        metadata: { order_id: orderId, package_id: packageId }
                    });
                    log(`   ✅ Transferred €${partnerAmount.toFixed(2)} to partner`);
                } else {
                    log(`   ⏳ Insufficient available balance (€${availableAmount.toFixed(2)} < €${partnerAmount.toFixed(2)})`);
                    log(`   ⏳ Transfer will need to be done manually or via scheduled job once funds clear`);
                    
                    // Store pending transfer in DB for later processing
                    await pool.query(`
                        UPDATE membership_purchases 
                        SET transfer_status = 'pending',
                            transfer_amount = $1
                        WHERE payment_intent_id = $2
                    `, [partnerAmount, paymentIntentId]);
                }
            } catch (e) {
                log(`   ⚠️ Transfer failed: ${e.message}`);
                
                await pool.query(`
                    UPDATE membership_purchases 
                    SET transfer_status = 'failed',
                        transfer_error = $1
                    WHERE payment_intent_id = $2
                `, [e.message, paymentIntentId]);
            }
        } else {
            log('   ⏭️ Skipped (no connected account or amount too low)');
        }
        markStep('6_end');
        
        // ========================================
        // STEP 7: Send Emails
        // ========================================
        markStep('7_start');
        log('📍 STEP 7: Queueing emails (non-blocking)...');
        
        // Fire and forget - DO NOT AWAIT
        setImmediate(() => {
            if (userEmail) {
                emailService.sendMembershipReceiptToBuyer({
                    userEmail,
                    packageName: pkg.name,
                    amountPaid: pkg.price,
                    buyingPower: buyingPowerAmount,
                    orderNumber: orderId,
                    walletAddress
                }).then(() => console.log('[EMAIL] ✅ Buyer receipt sent'))
                  .catch(e => console.log('[EMAIL] ⚠️ Buyer email failed:', e.message));
            }
            
            emailService.sendMembershipNotificationToOwner({
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
            }).then(() => console.log('[EMAIL] ✅ Owner notification sent'))
              .catch(e => console.log('[EMAIL] ⚠️ Owner email failed:', e.message));
        });
        
        log('   ✅ Emails queued (non-blocking)');
        markStep('7_end');
        
        // ========================================
        // COMPLETE
        // ========================================
        const totalTime = Date.now() - startTime;
        stepTiming.total_ms = totalTime;
        
        log('═'.repeat(60));
        log(`✅ COMPLETED in ${totalTime}ms`);
        log('═'.repeat(60));
        log(`   Order: ${orderId}`);
        log(`   TX: ${mintTxHash}`);
        log(`   TX Confirmed: ${txConfirmed}`);
        log(`   Kea€: ${buyingPowerAmount}`);
        log('═'.repeat(60));
        
        responseData.success = true;
        responseData.processing_time_ms = totalTime;
        responseData.message = txConfirmed ? 'Success' : 'Success (TX broadcast, confirmation pending)';
        
        res.json(responseData);
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        
        log('═'.repeat(60));
        log(`❌ FATAL ERROR after ${totalTime}ms`);
        log(`   Error: ${error.message}`);
        log(`   Stack: ${error.stack}`);
        log('═'.repeat(60));
        
        responseData.error = error.message;
        responseData.processing_time_ms = totalTime;
        
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

        const pkg = await getPackage(packageKey);
        if (!pkg) {
            return res.status(400).json({ success: false, error: 'Invalid or inactive package' });
        }

        if (price && Math.abs(pkg.price - price) > 1) {
            return res.status(400).json({ success: false, error: 'Price mismatch - please refresh' });
        }

        const orderNumber = 'KVM-' + String(Date.now()).slice(-6);

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

        await pool.query(
            'UPDATE membership_purchases SET payment_intent_id = $1 WHERE id = $2',
            [paymentIntent.id, order.id]
        );

        console.log(`✅ Payment intent created: ${paymentIntent.id} for ${pkg.name}`);

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
                    order.status === 'failed' || order.status === 'mint_failed' ? 'failed' : 
                    order.status === 'mint_pending_verification' ? 'verifying' : 'pending',
            orderId: order.order_number,
            txHash: order.metadata?.mint_tx_hash,
            error: order.error_message
        });
    } catch (error) {
        console.error('Error checking purchase status:', error);
        res.status(500).json({ success: false, error: 'Failed to check status' });
    }
});

// ============================================
// GET /api/membership/debug-env
// ============================================
router.get('/debug-env', (req, res) => {
    res.json({
        POLYGON_RPC: process.env.POLYGON_RPC ? `✅ ${process.env.POLYGON_RPC.substring(0, 50)}...` : '❌ Missing',
        PRIVATE_KEY: process.env.PRIVATE_KEY ? '✅ Set' : '❌ Missing',
        TOKEN_ADDRESS_POLYGON: process.env.TOKEN_ADDRESS_POLYGON || '❌ Missing',
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? '✅ Set' : '❌ Missing',
        CONNECTED_ACCOUNT_ID: CONNECTED_ACCOUNT_ID || 'Not configured',
        NODE_ENV: process.env.NODE_ENV || 'development',
        TX_POLL_TIMEOUT_MS,
        TX_POLL_INTERVAL_MS
    });
});

// ============================================
// Webhook Handler
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
        const paymentIntent = event.data.object;
        
        // Check if already processed
        const existing = await pool.query(
            'SELECT status FROM membership_purchases WHERE payment_intent_id = $1',
            [paymentIntent.id]
        );
        
        if (existing.rows.length > 0 && existing.rows[0].status === 'completed') {
            console.log('⚠️ Already processed, skipping');
        }
    } else if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object;
        await pool.query(
            "UPDATE membership_purchases SET status = 'failed', error_message = $1 WHERE payment_intent_id = $2",
            [paymentIntent.last_payment_error?.message || 'Payment failed', paymentIntent.id]
        );
    }

    res.json({ received: true });
});

module.exports = router;
