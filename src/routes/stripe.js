// src/routes/stripe.js
// Stripe webhook handler - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const minter = require('../minter');
const { DEFAULT_REFERRER_WALLET, PRESALE_CONFIG, EXPLORER_URL } = require('../config/constants');

// Initialize Stripe only if secret key exists
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log('Stripe initialized');
} else {
  console.log('Stripe not configured - STRIPE_SECRET_KEY missing');
}

// Helper function to calculate fees
function calculateFees(amountEUR, paymentMethod) {
  const feePercent = paymentMethod === 'crypto' 
    ? PRESALE_CONFIG.cryptoFeePercent 
    : PRESALE_CONFIG.cardFeePercent;
  const feeAmount = amountEUR * feePercent;
  const netAmount = amountEUR - feeAmount;
  return { feePercent, feeAmount, netAmount };
}

// Helper function for EUR to USD conversion (approximate)
async function getEURtoUSDRate() {
  // For production, you might want to use a real exchange rate API
  // Default rate if API fails
  return 1.08;
}

// Stripe webhook endpoint
// Note: This needs raw body, so it should be registered BEFORE json middleware
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.log('Stripe webhook received but Stripe not configured');
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

  console.log('Stripe webhook received:', event.type);

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// Handle successful payment
async function handlePaymentSuccess(paymentIntent) {
  console.log('Payment succeeded:', paymentIntent.id);
  
  try {
    const { wallet_address, amount_eur, tokens_to_mint, referral_code } = paymentIntent.metadata || {};
    
    if (!wallet_address) {
      console.error('No wallet address in payment metadata');
      return;
    }

    // Check for duplicate processing
    const existingResult = await db.pool.query(
      'SELECT id, status FROM presale_purchases WHERE payment_intent_id = $1',
      [paymentIntent.id]
    );

    if (existingResult.rows.length > 0 && existingResult.rows[0].status === 'completed') {
      console.log('Payment already processed:', paymentIntent.id);
      return;
    }

    const amountEUR = parseFloat(amount_eur) || (paymentIntent.amount / 100);
    const tokensToMint = parseFloat(tokens_to_mint) || (amountEUR / PRESALE_CONFIG.tokenPrice);

    // Calculate fees
    const { feeAmount, netAmount } = calculateFees(amountEUR, 'card');

    // Process referral bonus if applicable
    let referralBonus = 0;
    let referrerWallet = null;
    
    if (referral_code) {
      try {
        // Look up referral code
        const referralResult = await db.pool.query(
          'SELECT wallet_address FROM referral_codes WHERE code = $1 AND enabled = true',
          [referral_code.toUpperCase()]
        );
        
        if (referralResult.rows.length > 0) {
          referrerWallet = referralResult.rows[0].wallet_address;
          
          // Get referral settings
          const settingsResult = await db.pool.query(
            "SELECT value FROM app_settings WHERE key = 'referral_settings'"
          );
          
          if (settingsResult.rows.length > 0) {
            const settings = settingsResult.rows[0].value;
            if (settings.enabled && amountEUR >= (settings.minPurchaseForBonus || 10)) {
              if (settings.presaleBonusType === 'percentage') {
                referralBonus = tokensToMint * (settings.presaleBonusAmount / 100);
              } else {
                referralBonus = settings.presaleBonusAmount || 0;
              }
            }
          }
        }
      } catch (refError) {
        console.error('Error processing referral:', refError);
      }
    }

    // Update or insert purchase record
    if (existingResult.rows.length > 0) {
      await db.pool.query(
        `UPDATE presale_purchases 
         SET status = 'completed', 
             tokens_amount = $1,
             fee_amount = $2,
             net_amount = $3,
             referral_bonus = $4,
             referrer_wallet = $5,
             completed_at = NOW()
         WHERE payment_intent_id = $6`,
        [tokensToMint, feeAmount, netAmount, referralBonus, referrerWallet, paymentIntent.id]
      );
    } else {
      await db.pool.query(
        `INSERT INTO presale_purchases 
         (wallet_address, payment_intent_id, amount_eur, tokens_amount, status, fee_amount, net_amount, referral_code, referral_bonus, referrer_wallet, completed_at)
         VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9, NOW())`,
        [wallet_address, paymentIntent.id, amountEUR, tokensToMint, feeAmount, netAmount, referral_code, referralBonus, referrerWallet]
      );
    }

    // Mint tokens to buyer
    const totalTokens = tokensToMint + referralBonus;
    console.log(`Minting ${totalTokens} tokens to ${wallet_address}`);
    
    try {
      const mintResult = await minter.mintTokens(wallet_address, totalTokens);
      console.log('Mint result:', mintResult);
      
      // Update purchase with tx hash
      if (mintResult.tx_hash) {
        await db.pool.query(
          `UPDATE presale_purchases 
           SET tx_hash = $1, minted = true, minted_at = NOW()
           WHERE payment_intent_id = $2`,
          [mintResult.tx_hash, paymentIntent.id]
        );
      }
    } catch (mintError) {
      console.error('Error minting tokens:', mintError);
      // Mark as pending mint
      await db.pool.query(
        `UPDATE presale_purchases SET mint_status = 'pending' WHERE payment_intent_id = $1`,
        [paymentIntent.id]
      );
    }

    // Mint referral bonus to referrer if applicable
    if (referralBonus > 0 && referrerWallet) {
      console.log(`Minting ${referralBonus} referral bonus to ${referrerWallet}`);
      try {
        await minter.mintTokens(referrerWallet, referralBonus);
        
        // Record referral transaction
        await db.pool.query(
          `INSERT INTO referral_transactions 
           (referrer_wallet, referee_wallet, bonus_amount, bonus_type, source, created_at)
           VALUES ($1, $2, $3, 'presale', 'presale', NOW())`,
          [referrerWallet, wallet_address, referralBonus]
        );
      } catch (refMintError) {
        console.error('Error minting referral bonus:', refMintError);
      }
    }

    console.log('Payment processing complete for:', paymentIntent.id);
    
  } catch (error) {
    console.error('Error handling payment success:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(paymentIntent) {
  console.log('Payment failed:', paymentIntent.id);
  
  try {
    await db.pool.query(
      `UPDATE presale_purchases 
       SET status = 'failed', 
           error_message = $1,
           updated_at = NOW()
       WHERE payment_intent_id = $2`,
      [paymentIntent.last_payment_error?.message || 'Payment failed', paymentIntent.id]
    );
  } catch (error) {
    console.error('Error updating failed payment:', error);
  }
}

// Handle checkout session complete
async function handleCheckoutComplete(session) {
  console.log('Checkout session completed:', session.id);
  // Additional handling if using Checkout Sessions
}

module.exports = router;
