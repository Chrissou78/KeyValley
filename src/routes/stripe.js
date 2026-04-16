// src/routes/stripe.js
// Stripe webhook handler for membership purchases - MINTS Kea Euros

const express = require('express');
const router = express.Router();
const { pool } = require('../db-postgres');
const minter = require('../minter');

// Initialize Stripe
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe initialized');
} else {
  console.log('Stripe not configured - STRIPE_SECRET_KEY missing');
}

// Connected account for distribution
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
const PLATFORM_FEE_PERCENT = 10;

if (CONNECTED_ACCOUNT_ID) {
  console.log('Stripe Connect distribution enabled');
  console.log(`Platform fee: ${PLATFORM_FEE_PERCENT}% of NET`);
} else {
  console.log('Stripe Connect not configured');
}

// ============================================
// Stripe Webhook Endpoint
// ============================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📥 Stripe webhook received:', event.type);

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// ============================================
// Handle Successful Payment - MINT Kea Euros
// ============================================
async function handlePaymentSuccess(paymentIntent) {
  const { order_id, wallet_address, email, package_key, package_name, buying_power } = paymentIntent.metadata || {};

  console.log(`\n💳 Processing membership payment: ${paymentIntent.id}`);
  console.log(`   Order: ${order_id}, Package: ${package_key}`);
  console.log(`   Wallet: ${wallet_address}`);
  console.log(`   Kea Euros: €${buying_power}`);

  if (!order_id || !wallet_address) {
    console.error('❌ Missing order_id or wallet_address in metadata');
    return;
  }

  try {
    // Check if already processed
    const existingCheck = await pool.query(
      'SELECT status FROM membership_purchases WHERE id = $1',
      [order_id]
    );
    
    if (existingCheck.rows.length > 0 && existingCheck.rows[0].status === 'completed') {
      console.log('⚠️ Payment already processed, skipping');
      return;
    }

    // Get charge details for fee calculation
    const charges = await stripe.charges.list({
      payment_intent: paymentIntent.id,
      limit: 1
    });

    let stripeFee = 0;
    let netAmount = paymentIntent.amount / 100;
    const chargedAmount = paymentIntent.amount / 100;

    if (charges.data.length > 0) {
      const charge = charges.data[0];
      const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
      stripeFee = balanceTransaction.fee / 100;
      netAmount = balanceTransaction.net / 100;
    }

    // Calculate 90/10 split on NET
    const platformFee = netAmount * (PLATFORM_FEE_PERCENT / 100);
    const transferAmount = netAmount - platformFee;

    console.log(`💰 Payment Distribution:`);
    console.log(`   Charged:        €${chargedAmount.toFixed(2)}`);
    console.log(`   Stripe Fee:     €${stripeFee.toFixed(2)}`);
    console.log(`   NET:            €${netAmount.toFixed(2)}`);
    console.log(`   Platform (10%): €${platformFee.toFixed(2)}`);
    console.log(`   Transfer (90%): €${transferAmount.toFixed(2)}`);

    // ============================================
    // MINT Kea Euros TO USER'S WALLET
    // ============================================
    const buyingPowerAmount = parseFloat(buying_power) || 0;
    let mintTxHash = null;
    let mintSuccess = false;

    if (buyingPowerAmount > 0) {
      console.log(`\n🪙 Minting €${buyingPowerAmount} Kea Euros to ${wallet_address}...`);
      
      try {
        // skipBalanceCheck = true → always mint, even if user already has Kea Euros
        const mintResult = await minter.mintToAddress(wallet_address, buyingPowerAmount, true);
        
        if (mintResult.skipped) {
          console.log(`⚠️ Mint skipped: ${mintResult.reason}`);
        } else if (mintResult.receipt) {
          mintTxHash = mintResult.receipt.hash;
          mintSuccess = true;
          console.log(`✅ Kea Euros minted! TX: ${mintTxHash}`);
        }
      } catch (mintError) {
        console.error('❌ Minting failed:', mintError.message);
      }
    }

    // ============================================
    // UPDATE ORDER IN DATABASE
    // ============================================
    const status = mintSuccess ? 'completed' : 'pending_mint';
    
    await pool.query(`
      UPDATE membership_purchases 
      SET status = $1,
          stripe_fee = $2,
          net_amount = $3,
          platform_fee = $4,
          transfer_amount = $5,
          metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
      WHERE id = $7
    `, [
      status,
      stripeFee, 
      netAmount, 
      platformFee, 
      transferAmount,
      JSON.stringify({
        buying_power_minted: mintSuccess ? buyingPowerAmount : 0,
        mint_tx_hash: mintTxHash,
        mint_status: mintSuccess ? 'completed' : 'pending',
        minted_at: mintSuccess ? new Date().toISOString() : null
      }),
      order_id
    ]);

    console.log(`✅ Order ${order_id} updated: ${status}`);

    // ============================================
    // TRANSFER TO CONNECTED ACCOUNT
    // ============================================
    if (CONNECTED_ACCOUNT_ID && transferAmount > 0) {
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
            buying_power: buyingPowerAmount.toString()
          }
        });

        await pool.query(
          'UPDATE membership_purchases SET transfer_id = $1 WHERE id = $2',
          [transfer.id, order_id]
        );

        console.log(`✅ Transfer created: ${transfer.id} → €${transferAmount.toFixed(2)}`);
      } catch (transferError) {
        console.error('❌ Transfer failed:', transferError.message);
      }
    }

    console.log(`\n✅ Payment complete for order ${order_id}`);
    console.log(`   Kea Euros: ${mintSuccess ? '€' + buyingPowerAmount + ' minted' : 'PENDING'}`);
    if (mintTxHash) console.log(`   TX: ${mintTxHash}`);
    console.log('');

  } catch (error) {
    console.error('❌ Error handling payment success:', error);
    
    try {
      await pool.query(
        "UPDATE membership_purchases SET status = 'error', metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2",
        [JSON.stringify({ error: error.message, error_at: new Date().toISOString() }), order_id]
      );
    } catch (e) {
      console.error('Failed to update order with error:', e);
    }
  }
}

// ============================================
// Handle Failed Payment
// ============================================
async function handlePaymentFailed(paymentIntent) {
  const { order_id } = paymentIntent.metadata || {};
  
  console.log(`❌ Payment failed: ${paymentIntent.id}`);
  
  if (!order_id) {
    console.error('No order_id in failed payment metadata');
    return;
  }

  try {
    await pool.query(
      "UPDATE membership_purchases SET status = 'failed' WHERE id = $1",
      [order_id]
    );
    console.log(`Order ${order_id} marked as failed`);
  } catch (error) {
    console.error('Error updating failed payment:', error);
  }
}

module.exports = router;
