// src/routes/stripe.js
// Stripe webhook handler with payment distribution (no DB for distributions)

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

// Connected account for distribution
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID;

if (CONNECTED_ACCOUNT_ID) {
  console.log('Stripe Connect distribution enabled');
} else {
  console.log('Stripe Connect not configured - STRIPE_CONNECTED_ACCOUNT_ID missing');
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

// ============================================
// PAYMENT DISTRIBUTION LOGIC (No DB required)
// ============================================
async function distributePayment(paymentIntent) {
  if (!CONNECTED_ACCOUNT_ID) {
    console.log('⚠️ No connected account configured - skipping distribution');
    return null;
  }

  try {
    const chargedAmount = parseFloat(paymentIntent.metadata.amount_eur) || (paymentIntent.amount / 100);
    
    // Get the charge to find balance transaction
    const charges = await stripe.charges.list({
      payment_intent: paymentIntent.id,
      limit: 1
    });

    if (!charges.data.length) {
      console.error('No charge found for payment intent:', paymentIntent.id);
      return null;
    }

    const charge = charges.data[0];
    
    // Get balance transaction to find actual net amount (after Stripe fees)
    const balanceTransaction = await stripe.balanceTransactions.retrieve(
      charge.balance_transaction
    );

    const netAmountCents = balanceTransaction.net;
    const netAmount = netAmountCents / 100;
    
    // Calculate threshold: 97% of charged amount
    const threshold = chargedAmount * 0.97;
    
    let transferAmount;
    let feeType;

    if (netAmount >= threshold) {
      // Net is within 3% of charged: send charged - 4% to connected account
      transferAmount = chargedAmount * 0.96;
      feeType = 'standard';
      console.log(`✅ Standard distribution: Net €${netAmount.toFixed(2)} >= threshold €${threshold.toFixed(2)}`);
    } else {
      // Net is less than 97%: send net - 1% to connected account
      transferAmount = netAmount * 0.99;
      feeType = 'reduced';
      console.log(`⚠️ Reduced distribution: Net €${netAmount.toFixed(2)} < threshold €${threshold.toFixed(2)}`);
    }

    const transferAmountCents = Math.round(transferAmount * 100);
    const platformKeeps = netAmount - transferAmount;

    console.log('💰 Payment Distribution:', {
      paymentIntentId: paymentIntent.id,
      charged: `€${chargedAmount.toFixed(2)}`,
      stripeFees: `€${(chargedAmount - netAmount).toFixed(2)}`,
      netReceived: `€${netAmount.toFixed(2)}`,
      toConnectedAccount: `€${transferAmount.toFixed(2)}`,
      platformKeeps: `€${platformKeeps.toFixed(2)}`,
      feeType: feeType,
      wallet: paymentIntent.metadata.wallet_address
    });

    // Create transfer to connected account
    const transfer = await stripe.transfers.create({
      amount: transferAmountCents,
      currency: paymentIntent.currency || 'eur',
      destination: CONNECTED_ACCOUNT_ID,
      transfer_group: paymentIntent.id,
      metadata: {
        payment_intent: paymentIntent.id,
        charged_amount: chargedAmount.toFixed(2),
        net_amount: netAmount.toFixed(2),
        transfer_amount: transferAmount.toFixed(2),
        platform_fee: platformKeeps.toFixed(2),
        fee_type: feeType,
        wallet_address: paymentIntent.metadata.wallet_address
      }
    });

    console.log('✅ Transfer created:', transfer.id);

    return {
      success: true,
      transferId: transfer.id,
      transferAmount,
      platformKeeps,
      feeType
    };

  } catch (error) {
    console.error('❌ Distribution failed:', {
      paymentIntentId: paymentIntent.id,
      error: error.message,
      wallet: paymentIntent.metadata.wallet_address
    });

    return { success: false, error: error.message };
  }
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

    // ============================================
    // DISTRIBUTE PAYMENT TO CONNECTED ACCOUNT
    // ============================================
    const distributionResult = await distributePayment(paymentIntent);
    if (distributionResult?.success) {
      console.log('✅ Distribution completed:', distributionResult.transferId);
    } else if (distributionResult) {
      console.error('❌ Distribution failed - check Stripe dashboard');
    }

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
