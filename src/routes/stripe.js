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
// Handle Successful Payment - MINT Kea Euros THEN Credit DB
// ============================================
async function handlePaymentSuccess(paymentIntent) {
  console.log(`\n💳 Stripe webhook received for: ${paymentIntent.id}`);
  console.log('⚠️ Skipping minting - handled by mint-and-capture');
  
  // Everything is handled by mint-and-capture, webhook does nothing
  return;
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
