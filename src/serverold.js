const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { ethers } = require('ethers');
require('dotenv').config();

const db = require('./db-postgres');
const minter = require('./minter');
const { getNetworkConfig } = require('./config/networks');

// ===========================================
// Key Constants
// ===========================================
const DEFAULT_REFERRER_WALLET = '0xdD4104A780142EfB9566659f26d3317714a81510'.toLowerCase();
const MINTER_ADDRESS = process.env.MINTER_ADDRESS || '0xdD4104A780142EfB9566659f26d3317714a81510';
const VIP_TOKEN_ADDRESS = '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com';

// ===========================================
// Stripe Setup (Optional - graceful fallback)
// ===========================================
let stripe = null;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        const Stripe = require('stripe');
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        console.log(' Stripe initialized');
    } else {
        console.log('Ã‚Â  Stripe not configured (STRIPE_SECRET_KEY missing)');
    }
} catch (e) {
    console.log('Ã‚Â  Stripe not available:', e.message);
}

// ===========================================
// Presale Configuration
// ===========================================
const PRESALE_CONFIG = {
    presaleEnabled: true,
    saleTargetEUR: 500000,
    totalTokens: 1000000,
    tokenPrice: 1.00,
    minPurchase: 10,
    maxPurchase: 10000,
    presaleWallet: process.env.PRESALE_WALLET || '0xdD4104A780142EfB9566659f26d3317714a81510',
    tokenAddress: VIP_TOKEN_ADDRESS,
    tokenDecimals: 18,
    chainId: 137,
    usdcAddress: USDC_ADDRESS,
    cryptoFeePercent: 0.015,
    cardFeePercent: 0.04
};

// Load presale settings from DB on startup
async function loadPresaleSettings() {
    try {
        const result = await db.pool.query(
            "SELECT value FROM app_settings WHERE key = 'presale_config'"
        );
        if (result.rows.length > 0) {
            const saved = JSON.parse(result.rows[0].value);
            Object.assign(PRESALE_CONFIG, saved);
            console.log(' Loaded presale settings from DB');
        }
    } catch (e) {
        console.log('Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ No saved presale settings, using defaults');
    }
}

// ===========================================
// Minimal ABIs
// ===========================================
const VIP_TOKEN_ABI = [
    'function mint(address to, uint256 amount) external',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)'
];

const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// ===========================================
// Express App Setup
// ===========================================
const app = express();
const PORT = process.env.API_PORT || 3000;

// ===========================================
// SINGLE calculateTokenBonus Definition
// ===========================================
async function calculateTokenBonus(eurAmount) {
    try {
        const result = await db.pool.query(`
            SELECT min_eur, bonus_percent 
            FROM presale_bonus_tiers 
            WHERE is_active = true AND min_eur <= $1 
            ORDER BY min_eur DESC 
            LIMIT 1
        `, [eurAmount]);
        
        if (result.rows.length > 0) {
            return {
                bonusPercent: parseFloat(result.rows[0].bonus_percent),
                minEur: parseFloat(result.rows[0].min_eur)
            };
        }
        return { bonusPercent: 0, minEur: 0 };
    } catch (error) {
        console.error('Error calculating bonus:', error);
        return { bonusPercent: 0, minEur: 0 };
    }
}

// ===========================================
// Referral Helper Functions
// ===========================================
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function getReferralSettings() {
    try {
        const result = await db.pool.query('SELECT * FROM referral_settings WHERE id = 1');
        if (result.rows.length === 0) {
            return {
                enabled: false,
                bonusType: 'fixed',
                bonusAmount: 5,
                presaleBonusType: 'percentage',
                presaleBonusAmount: 5,
                minPurchaseForBonus: 10
            };
        }
        const s = result.rows[0];
        return {
            enabled: s.enabled,
            bonusType: s.bonus_type || 'fixed',
            bonusAmount: parseFloat(s.bonus_amount) || 5,
            presaleBonusType: s.presale_bonus_type || 'percentage',
            presaleBonusAmount: parseFloat(s.presale_bonus_amount) || 5,
            minPurchaseForBonus: parseFloat(s.min_purchase_for_bonus) || 10
        };
    } catch (error) {
        console.error('Error getting referral settings:', error);
        return {
            enabled: false,
            bonusType: 'fixed',
            bonusAmount: 5,
            presaleBonusType: 'percentage',
            presaleBonusAmount: 5,
            minPurchaseForBonus: 10
        };
    }
}

// Validate Ethereum address
function validateAddress(address) {
    try {
        return ethers.isAddress(address);
    } catch {
        return false;
    }
}

// ===========================================
// Admin Authentication Middleware
// ===========================================
async function requireAdminAuth(req, res, next) {
    const sessionId = req.cookies?.admin_session;
    
    if (!sessionId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.redirect('/login');
    }
    
    const session = await db.getSession(sessionId);
    if (!session) {
        res.clearCookie('admin_session', { path: '/' });
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Session expired' });
        }
        return res.redirect('/login');
    }
    
    const admin = await db.getAdminByEmail(session.username);
    if (!admin) {
        res.clearCookie('admin_session', { path: '/' });
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        return res.redirect('/login');
    }
    
    req.admin = admin;
    next();
}

async function ensureDefaultData() {
  try {
    // Ensure presale_config row exists
    const configCheck = await db.pool.query('SELECT id FROM presale_config WHERE id = 1');
    if (configCheck.rows.length === 0) {
      await db.pool.query(`
        INSERT INTO presale_config (id, presale_enabled, sale_target_eur, total_tokens, token_price, min_purchase, max_purchase, presale_wallet)
        VALUES (1, TRUE, 500000, 1000000, 1.00, 10, 10000, $1)
      `, [process.env.PRESALE_WALLET || '0xdD4104A780142EfB9566659f26d3317714a81510']);
      console.log(' Default presale config created');
    }

    // Ensure default bonus tiers exist
    const tiersCheck = await db.pool.query('SELECT id FROM presale_bonus_tiers WHERE is_active = TRUE LIMIT 1');
    if (tiersCheck.rows.length === 0) {
      const defaultTiers = [
        { min_eur: 100, bonus_percent: 5, label: ' (5% Bonus)' },
        { min_eur: 1000, bonus_percent: 25, label: ',000+ (25% Bonus)' },
        { min_eur: 10000, bonus_percent: 50, label: ',000+ (50% Bonus)' }
      ];
      for (const tier of defaultTiers) {
        await db.pool.query(
          'INSERT INTO presale_bonus_tiers (min_eur, bonus_percent, label, active) VALUES ($1, $2, $3, TRUE)',
          [tier.min_eur, tier.bonus_percent, tier.label]
        );
      }
      console.log(' Default bonus tiers created: Ã‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬Ã‚Â , Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬Ã‚Â , Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬Ã‚Â ');
    }

    // Ensure default referral settings exist
    const settingsCheck = await db.pool.query("SELECT id FROM app_settings WHERE key = 'referral_settings'");
    if (settingsCheck.rows.length === 0) {
      const defaultSettings = {
        enabled: true,
        claimBonusType: 'fixed',
        claimBonusAmount: 2,
        presaleBonusType: 'percentage',
        presaleBonusAmount: 5,
        autoPayBonus: true,
        minPayoutThreshold: 0,
        minPurchaseForBonus: 10
      };
      await db.pool.query(
        "INSERT INTO app_settings (key, value) VALUES ('referral_settings', $1)",
        [JSON.stringify(defaultSettings)]
      );
      console.log(' Default referral settings created');
    }

    // Ensure default mint amount setting exists
    const mintCheck = await db.pool.query("SELECT id FROM app_settings WHERE key = 'mint_amount'");
    if (mintCheck.rows.length === 0) {
      await db.pool.query(
        "INSERT INTO app_settings (key, value) VALUES ('mint_amount', $1)",
        [JSON.stringify({ amount: parseInt(process.env.MINT_AMOUNT) || 2 })]
      );
      console.log(' Default mint amount setting created');
    }

    // Ensure default admin exists
    const adminCheck = await db.pool.query('SELECT id FROM admin_whitelist LIMIT 1');
    if (adminCheck.rows.length === 0 && process.env.DEFAULT_ADMIN_EMAIL) {
      await db.pool.query(
        'INSERT INTO admin_whitelist (email, role) VALUES ($1, $2)',
        [process.env.DEFAULT_ADMIN_EMAIL, 'super_admin']
      );
      console.log(' Default admin created:', process.env.DEFAULT_ADMIN_EMAIL);
    }

  } catch (error) {
    console.error(' Error ensuring default data:', error);
  }
}

async function ensureDatabaseTables() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Registrants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrants (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) UNIQUE NOT NULL,
        email VARCHAR(255),
        name VARCHAR(255),
        source VARCHAR(50) DEFAULT 'manual',
        minted BOOLEAN DEFAULT FALSE,
        mint_tx_hash VARCHAR(66),
        minted_at TIMESTAMP,
        referrer_wallet VARCHAR(42),
        referrer_code VARCHAR(20),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_registrants_wallet ON registrants(wallet_address)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_registrants_referrer ON registrants(referrer_wallet)');

    // Presale purchases table
    await client.query(`
      CREATE TABLE IF NOT EXISTS presale_purchases (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        email VARCHAR(255),
        token_amount DECIMAL(18,6) NOT NULL,
        eur_amount DECIMAL(18,2),
        usd_amount DECIMAL(18,2),
        payment_method VARCHAR(20) NOT NULL,
        payment_amount DECIMAL(18,6),
        payment_tx_hash VARCHAR(66),
        stripe_payment_intent VARCHAR(100),
        platform_fee DECIMAL(18,6),
        net_amount DECIMAL(18,6),
        actual_stripe_fee DECIMAL(18,6),
        referrer_wallet VARCHAR(42),
        referrer_code VARCHAR(20),
        referrer_bonus DECIMAL(18,6) DEFAULT 0,
        referral_bonus_amount DECIMAL(18,6) DEFAULT 0,
        referral_bonus_tx VARCHAR(66),
        referral_bonus_paid BOOLEAN DEFAULT FALSE,
        purchase_bonus_percent DECIMAL(5,2) DEFAULT 0,
        purchase_bonus_tokens DECIMAL(18,6) DEFAULT 0,
        purchase_bonus_tx VARCHAR(66),
        status VARCHAR(20) DEFAULT 'pending',
        mint_tx_hash VARCHAR(66),
        minted_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_purchases_wallet ON presale_purchases(wallet_address)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_purchases_status ON presale_purchases(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_purchases_stripe ON presale_purchases(stripe_payment_intent)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_purchases_tx ON presale_purchases(payment_tx_hash)');

    // Presale config table
    await client.query(`
      CREATE TABLE IF NOT EXISTS presale_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        presale_enabled BOOLEAN DEFAULT TRUE,
        sale_target_eur DECIMAL(18,2) DEFAULT 500000,
        total_tokens DECIMAL(18,2) DEFAULT 1000000,
        tokens_sold DECIMAL(18,6) DEFAULT 0,
        eur_raised DECIMAL(18,2) DEFAULT 0,
        token_price DECIMAL(10,4) DEFAULT 1.00,
        min_purchase DECIMAL(18,2) DEFAULT 10,
        max_purchase DECIMAL(18,2) DEFAULT 10000,
        presale_wallet VARCHAR(42),
        crypto_fee_percent DECIMAL(5,4) DEFAULT 0.015,
        card_fee_percent DECIMAL(5,4) DEFAULT 0.04,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Presale bonus tiers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS presale_bonus_tiers (
        id SERIAL PRIMARY KEY,
        min_eur DECIMAL(18,2) NOT NULL,
        bonus_percent DECIMAL(5,2) NOT NULL,
        label VARCHAR(100),
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // App settings table
    await client.query(`
      DROP TABLE IF EXISTS app_settings CASCADE; CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Referral codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        owner_wallet VARCHAR(42) NOT NULL,
        owner_email VARCHAR(255),
        enabled BOOLEAN DEFAULT TRUE,
        total_referrals INTEGER DEFAULT 0,
        total_claims INTEGER DEFAULT 0,
        total_presale_purchases INTEGER DEFAULT 0,
        total_bonus_earned DECIMAL(18,6) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_codes_wallet ON referral_codes(owner_wallet)');

    // Referrals tracking table - recreate with correct schema
    await client.query('DROP TABLE IF EXISTS referrals CASCADE');
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_wallet VARCHAR(42) NOT NULL,
        referrer_code VARCHAR(20),
        referred_wallet VARCHAR(42) NOT NULL,
        referred_email VARCHAR(255),
        source VARCHAR(20) DEFAULT 'claim',
        signup_bonus_paid BOOLEAN DEFAULT FALSE,
        signup_bonus_amount DECIMAL(18,6) DEFAULT 0,
        signup_bonus_tx VARCHAR(66),
        presale_bonus_paid BOOLEAN DEFAULT FALSE,
        presale_bonus_amount DECIMAL(18,6) DEFAULT 0,
        presale_bonus_tx VARCHAR(66),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referred_wallet)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_wallet)');

    // Claims table
    await client.query(`
      CREATE TABLE IF NOT EXISTS claims (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) UNIQUE NOT NULL,
        token_amount DECIMAL(18,6) NOT NULL,
        tx_hash VARCHAR(66),
        status VARCHAR(20) DEFAULT 'pending',
        referrer_wallet VARCHAR(42),
        referrer_code VARCHAR(20),
        claimed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Admin sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) UNIQUE NOT NULL,
        admin_email VARCHAR(255) NOT NULL,
        wallet_address VARCHAR(42),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_admin_sessions_sid ON admin_sessions(session_id)');

    // Admin whitelist table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_whitelist (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        wallet_address VARCHAR(42),
        role VARCHAR(20) DEFAULT 'admin',
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log(' Database tables ensured');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(' Database setup error:', error);
    throw error;
  } finally {
    client.release();
  }
}


// ===========================================
// STRIPE WEBHOOK - Must be BEFORE express.json()
// ===========================================
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) {
        console.error(' Stripe not initialized');
        return res.status(503).send('Stripe not configured');
    }
    
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
        console.error(' STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).send('Webhook secret not configured');
    }
    
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(' Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    console.log('\n' + '='.repeat(70));
    console.log(' STRIPE WEBHOOK RECEIVED');
    console.log('='.repeat(70));
    console.log('   Event Type:', event.type);
    console.log('   Event ID:', event.id);
    console.log('   Timestamp:', new Date().toISOString());
    
    if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
        console.log('   Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ Ignoring event type:', event.type);
        return res.json({ received: true, ignored: true });
    }
    
    let walletAddress, tokenAmount, paymentId, totalAmount, baseAmount, feeAmount;
    
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        walletAddress = session.metadata?.walletAddress;
        tokenAmount = session.metadata?.tokenAmount;
        paymentId = session.id;
        totalAmount = (session.amount_total || 0) / 100;
        baseAmount = parseFloat(session.metadata?.baseAmount) || totalAmount;
        feeAmount = parseFloat(session.metadata?.feeAmount) || 0;
    } else {
        const paymentIntent = event.data.object;
        walletAddress = paymentIntent.metadata?.walletAddress;
        tokenAmount = paymentIntent.metadata?.tokenAmount;
        paymentId = paymentIntent.id;
        totalAmount = (paymentIntent.amount || 0) / 100;
        baseAmount = parseFloat(paymentIntent.metadata?.baseAmount) || totalAmount;
        feeAmount = parseFloat(paymentIntent.metadata?.feeAmount) || 0;
    }
    
    if (!walletAddress || !tokenAmount) {
        console.error(' Missing metadata');
        return res.json({ received: true, error: 'Missing metadata' });
    }
    
    if (!ethers.isAddress(walletAddress)) {
        console.error(' Invalid wallet address format:', walletAddress);
        return res.json({ received: true, error: 'Invalid wallet address' });
    }
    
    console.log('\n PAYMENT DETAILS:');
    console.log('   Payment ID:', paymentId);
    console.log('   Buyer Wallet:', walletAddress);
    console.log('   Base Tokens:', tokenAmount, 'VIP');
    console.log('   Base Amount: ' + baseAmount.toFixed(2));
    console.log('   Fee Amount: ' + feeAmount.toFixed(2), '(4%)');
    console.log('   Total Charged: ' + totalAmount.toFixed(2));
    
    try {
        const normalizedAddress = walletAddress.toLowerCase();
        const networkConfig = getNetworkConfig();
        
        // Get actual Stripe fee
        let actualStripeFee = 0;
        let stripeFeePct = 0;
        const paymentIntentObj = event.data.object;
        
        if (paymentIntentObj.latest_charge) {
            try {
                const charge = await stripe.charges.retrieve(paymentIntentObj.latest_charge, {
                    expand: ['balance_transaction']
                });
                if (charge.balance_transaction && typeof charge.balance_transaction === 'object') {
                    actualStripeFee = charge.balance_transaction.fee / 100;
                    stripeFeePct = totalAmount > 0 ? (actualStripeFee / totalAmount) * 100 : 0;
                }
            } catch (e) {
                console.log('   Ã‚Â  Could not fetch balance transaction:', e.message);
            }
        }
        
        console.log('\n FEE BREAKDOWN:');
        console.log('   Actual Stripe Fee: ' + actualStripeFee.toFixed(2), `(${stripeFeePct.toFixed(2)}%)`);
        console.log('   Our Platform Fee: ' + feeAmount.toFixed(2), '(4%)');
        console.log('   Net to Business: ' + (baseAmount - actualStripeFee).toFixed(2));
        
        // Currency conversion
        let eurUsdRate = 1.19;
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            if (rateRes.ok) {
                const rateData = await rateRes.json();
                eurUsdRate = rateData.rates?.USD || 1.19;
            }
        } catch (e) {
            console.log('   Ã‚Â  Using default EUR/USD rate:', eurUsdRate);
        }
        
        const usdAmount = totalAmount * eurUsdRate;
        
        console.log('\n CONVERSION:');
        console.log('   EUR/USD Rate:', eurUsdRate.toFixed(4));
        console.log('   USD Equivalent: $' + usdAmount.toFixed(2));
        
        // Check for duplicates
        const existing = await db.pool.query(
            'SELECT id, status, mint_tx_hash FROM presale_purchases WHERE stripe_payment_intent = $1 OR payment_tx_hash = $1',
            [paymentId]
        );
        
        if (existing.rows.length > 0) {
            const purchase = existing.rows[0];
            if (purchase.status === 'completed' && purchase.mint_tx_hash) {
                console.log('\nÃ‚Â  ALREADY PROCESSED');
                return res.json({ 
                    received: true, 
                    status: 'already_processed', 
                    purchaseId: purchase.id,
                    mintTxHash: purchase.mint_tx_hash
                });
            }
        }
        
        // Get referrer
        let referrerWallet = null;
        let referrerCode = null;
        let isDefaultReferrer = false;
        
        console.log('\n REFERRAL LOOKUP:');
        
        try {
            const registrantResult = await db.pool.query(
                'SELECT referrer_wallet, referrer_code FROM registrants WHERE address = $1',
                [normalizedAddress]
            );
            
            if (registrantResult.rows.length > 0 && registrantResult.rows[0].referrer_wallet) {
                referrerWallet = registrantResult.rows[0].referrer_wallet.toLowerCase();
                referrerCode = registrantResult.rows[0].referrer_code;
                console.log('    From registration:', referrerWallet);
            }
        } catch (refLookupError) {
            console.log('   Ã‚Â  Lookup error:', refLookupError.message);
        }
        
        if (!referrerWallet) {
            referrerWallet = DEFAULT_REFERRER_WALLET;
            referrerCode = 'DEFAULT';
            isDefaultReferrer = true;
            console.log('   Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ Using default referrer:', referrerWallet);
        }
        
        // Calculate purchase bonus
        console.log('\n PURCHASE BONUS CALCULATION:');
        console.log('   Base Amount (EUR): ' + baseAmount.toFixed(2));
        
        const bonusInfo = await calculateTokenBonus(baseAmount);
        const baseTokens = parseFloat(tokenAmount);
        let bonusTokens = 0;
        
        if (bonusInfo.bonusPercent > 0) {
            bonusTokens = Math.floor(baseTokens * bonusInfo.bonusPercent / 100);
            console.log('    BONUS TIER REACHED!');
            console.log('      Tier: ' + bonusInfo.bonusPercent + '% (min ' + bonusInfo.minEur + ')');
            console.log('      Bonus Tokens: +' + bonusTokens);
        } else {
            console.log('   Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ No bonus tier reached');
        }
        
        const totalTokensToMint = baseTokens + bonusTokens;
        console.log('    TOTAL TO MINT: ' + totalTokensToMint + ' VIP');
        // Record/Update purchase
        let purchaseId;
        
        if (existing.rows.length > 0) {
            purchaseId = existing.rows[0].id;
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'paid', 
                    eur_amount = $2, 
                    usd_amount = $3, 
                    platform_fee = $4, 
                    net_amount = $5,
                    actual_stripe_fee = $6, 
                    referrer_bonus = $7,
                    purchase_bonus_percent = $8, 
                    purchase_bonus_tokens = $9,
                    updated_at = NOW()
                WHERE id = $1
            `, [
                purchaseId, 
                totalAmount, 
                usdAmount, 
                feeAmount, 
                baseAmount, 
                actualStripeFee, 
                referrerWallet, 
                bonusInfo.bonusPercent, 
                bonusTokens
            ]);
            console.log('\n UPDATED EXISTING PURCHASE:', purchaseId);
        } else {
            const purchaseResult = await db.pool.query(`
                INSERT INTO presale_purchases 
                (wallet_address, token_amount, eur_amount, usd_amount, payment_method, 
                 stripe_payment_intent, payment_amount, platform_fee, net_amount, actual_stripe_fee, 
                 referrer_bonus, purchase_bonus_percent, purchase_bonus_tokens, status, created_at)
                VALUES ($1, $2, $3, $4, 'stripe', $5, $6, $7, $8, $9, $10, $11, $12, 'paid', NOW())
                RETURNING id
            `, [
                normalizedAddress, 
                baseTokens,
                totalAmount, 
                usdAmount, 
                paymentId, 
                totalAmount, 
                feeAmount, 
                baseAmount, 
                actualStripeFee, 
                referrerWallet, 
                bonusInfo.bonusPercent, 
                bonusTokens
            ]);
            purchaseId = purchaseResult.rows[0].id;
            console.log('\n CREATED NEW PURCHASE:', purchaseId);
        }
        
        // Mint tokens
        console.log('\n MINTING TOKENS...');
        console.log('   Recipient:', normalizedAddress);
        console.log('   Amount:', totalTokensToMint, 'VIP');

        await minter.initialize();

        let mintResult;
        try {
            mintResult = await minter.mintToAddress(normalizedAddress, totalTokensToMint, true); 
        } catch (mintError) {
            console.error('    Mint exception:', mintError.message);
            mintResult = { error: mintError.message };
        }

        const mintSuccess = mintResult && !mintResult.error && (mintResult.receipt || mintResult.hash || mintResult.txHash || mintResult.success);
        
        if (mintSuccess) {
            const mintTxHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash || mintResult.transactionHash;
            
            console.log('    MINTED SUCCESSFULLY!');
            console.log('   TX Hash:', mintTxHash);
            console.log('   Explorer:', networkConfig.explorer + '/tx/' + mintTxHash);
            
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', 
                    mint_tx_hash = $1, 
                    purchase_bonus_tx = $1, 
                    minted_at = NOW()
                WHERE id = $2
            `, [mintTxHash, purchaseId]);
            
            // Update presale stats
            console.log('\nÃ‚Â  UPDATING PRESALE STATS...');
            try {
                await db.pool.query(`
                    UPDATE presale_config 
                    SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                        eur_raised = COALESCE(eur_raised, 0) + $2,
                        updated_at = NOW() 
                    WHERE id = 1
                `, [totalTokensToMint, baseAmount]);
                console.log('    +' + totalTokensToMint + ' tokens sold');
            } catch (configError) {
                console.error('   Ã‚Â  Config update error:', configError.message);
            }
            
            // Process referral bonus
            console.log('\n REFERRAL BONUS PROCESSING:');
            console.log('   Referrer:', referrerWallet);
            console.log('   Is Default:', isDefaultReferrer);
            
            let referralBonusPaid = false;
            let referralBonusAmount = 0;
            let referralBonusTxHash = null;
            
            if (referrerWallet && referrerWallet.toLowerCase() !== normalizedAddress.toLowerCase()) {
                try {
                    const settingsResult = await db.pool.query(
                        'SELECT * FROM referral_settings WHERE id = 1'
                    );
                    
                    if (settingsResult.rows.length > 0 && settingsResult.rows[0].enabled) {
                        const settings = settingsResult.rows[0];
                        const minPurchase = parseFloat(settings.min_purchase_for_bonus) || 0;
                        
                        if (usdAmount >= minPurchase) {
                            if (settings.presale_bonus_type === 'fixed') {
                                referralBonusAmount = parseFloat(settings.presale_bonus_amount) || 0;
                            } else if (settings.presale_bonus_type === 'percentage') {
                                referralBonusAmount = (baseTokens * parseFloat(settings.presale_bonus_amount)) / 100;
                            }
                            
                            console.log('   Calculated Bonus:', referralBonusAmount, 'VIP');
                            
                            if (referralBonusAmount > 0) {
                                console.log('    Minting referral bonus to:', referrerWallet);
                                
                                try {
                                    const bonusMintResult = await minter.mintToAddress(referrerWallet, referralBonusAmount, true);
                                    
                                    if (bonusMintResult && !bonusMintResult.error) {
                                        referralBonusTxHash = bonusMintResult.txHash || bonusMintResult.receipt?.hash || bonusMintResult.hash;
                                        
                                        if (referralBonusTxHash) {
                                            referralBonusPaid = true;
                                            console.log('    Referral bonus minted!');
                                            console.log('   TX:', referralBonusTxHash);
                                            
                                            await db.pool.query(`
                                                UPDATE presale_purchases 
                                                SET referral_bonus_amount = $1, 
                                                    referral_bonus_paid = true,
                                                    referral_bonus_tx = $3
                                                WHERE id = $2
                                            `, [referralBonusAmount, purchaseId, referralBonusTxHash]);
                                            
                                            if (!isDefaultReferrer && referrerCode && referrerCode !== 'DEFAULT') {
                                                await db.pool.query(`
                                                    UPDATE referral_codes 
                                                    SET total_presale_purchases = COALESCE(total_presale_purchases, 0) + 1,
                                                        total_bonus_earned = COALESCE(total_bonus_earned, 0) + $1,
                                                        updated_at = NOW()
                                                    WHERE code = $2
                                                `, [referralBonusAmount, referrerCode]);
                                                
                                                try {
                                                    await db.pool.query(`
                                                        INSERT INTO referrals 
                                                        (referrer_wallet, referred_wallet, referral_code, presale_bonus_paid, bonus_tx_hash, created_at)
                                                        VALUES ($1, $2, $3, $4, $5, NOW())
                                                        ON CONFLICT (referred_wallet) 
                                                        DO UPDATE SET 
                                                            presale_bonus_paid = COALESCE(referrals.presale_bonus_paid, 0) + $4,
                                                            bonus_tx_hash = $5,
                                                            updated_at = NOW()
                                                    `, [referrerWallet, normalizedAddress, referrerCode, referralBonusAmount, referralBonusTxHash]);
                                                } catch (refInsertError) {
                                                    console.log('   Ã‚Â  Could not record referral:', refInsertError.message);
                                                }
                                            }
                                        }
                                    }
                                } catch (bonusMintError) {
                                    console.error('    Referral bonus mint exception:', bonusMintError.message);
                                }
                            }
                        } else {
                            console.log('   ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ Below minimum purchase for referral bonus');
                        }
                    } else {
                        console.log('   ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ Referral bonuses disabled');
                    }
                } catch (refError) {
                    console.error('   Ã‚Â  Referral bonus error:', refError.message);
                }
            } else {
                console.log('   ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ No eligible referrer');
            }
            
            console.log('\n' + '='.repeat(70));
            console.log(' WEBHOOK PROCESSING COMPLETE');
            console.log('='.repeat(70) + '\n');
            
            return res.json({ 
                received: true,
                success: true,
                purchaseId,
                mintTxHash,
                baseTokens,
                bonusTokens,
                totalTokens: totalTokensToMint,
                referralBonus: referralBonusPaid ? {
                    amount: referralBonusAmount,
                    txHash: referralBonusTxHash,
                    referrer: referrerWallet
                } : null
            });
            
        } else {
            console.log('\n MINTING FAILED');
            console.log('   Error:', mintResult?.error || 'Unknown error');
            
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'pending_mint', 
                    error_message = $1
                WHERE id = $2
            `, [mintResult?.error || 'Unknown minting error', purchaseId]);
            
            return res.json({ 
                received: true,
                success: false,
                purchaseId,
                status: 'pending_mint',
                error: mintResult?.error || 'Minting failed'
            });
        }
        
    } catch (error) {
        console.error('\n WEBHOOK PROCESSING ERROR:', error);
        return res.json({ 
            received: true, 
            success: false,
            error: 'Internal processing error'
        });
    }
});

// ===========================================
// MIDDLEWARE - Must be AFTER Stripe webhook
// ===========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
    }
}));

// Ensure DB is initialized
app.use(async (req, res, next) => {
    try {
        await db.initDb();
        next();
    } catch (error) {
        console.error('DB initialization error:', error);
        next();
    }
});

// ===========================================
// Public Pages
// ===========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/claim', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'claim', 'index.html'));
});

app.get('/claim/?', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'claim', 'index.html'));
});

// Questionnaire page
app.get('/claim/questionnaire', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'claim', 'questionnaire.html'));
});


app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile', 'index.html'));
});

app.get('/presale', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'presale.html'));
});

app.get('/login', async (req, res) => {
    const sessionId = req.cookies?.admin_session;
    if (sessionId) {
        try {
            const session = await db.getSession(sessionId);
            if (session) {
                const admin = await db.getAdminByEmail(session.username);
                if (admin) {
                    return res.redirect('/dashboard');
                }
            }
        } catch (err) {
            console.error('Session check error:', err);
        }
    }
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.get('/dashboard', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms', 'index.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy', 'index.html'));
});

// Debug route - add this temporarily
app.get('/debug-claim', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'claim', 'index.html');
    const fs = require('fs');
    
    res.json({
        filePath: filePath,
        exists: fs.existsSync(filePath),
        dirname: __dirname,
        files: fs.existsSync(path.join(__dirname, 'public', 'claim')) 
            ? fs.readdirSync(path.join(__dirname, 'public', 'claim'))
            : 'folder not found'
    });
});

// ===========================================
// WalletTwo Token Exchange Proxy
// ===========================================
app.post('/api/wallettwo/exchange', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code is required' });
    }
    
    try {
        console.log(' Exchanging WalletTwo code for token...');
        
        const exchangeResponse = await fetch(`https://api.wallettwo.com/auth/consent?code=${code}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!exchangeResponse.ok) {
            const errorText = await exchangeResponse.text();
            return res.status(exchangeResponse.status).json({ error: 'Exchange failed', details: errorText });
        }
        
        const tokenData = await exchangeResponse.json();
        
        if (tokenData.access_token) {
            const userResponse = await fetch('https://api.wallettwo.com/auth/userinfo', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                return res.json({
                    access_token: tokenData.access_token,
                    user: userData
                });
            }
        }
        
        res.json(tokenData);
        
    } catch (error) {
        console.error(' WalletTwo exchange error:', error);
        res.status(500).json({ error: 'Exchange failed', details: error.message });
    }
});

// ===========================================
// Admin Authentication API
// ===========================================
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { email, walletAddress, name } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        
        console.log('[Admin Auth] Checking:', email);
        
        const isWhitelisted = await db.isAdminWhitelisted(email);
        
        if (!isWhitelisted) {
            console.log('[Admin Auth] Not whitelisted:', email);
            return res.status(403).json({ success: false, error: 'Access denied. Your email is not authorized.' });
        }
        
        if (walletAddress) {
            await db.updateAdminWallet(email, walletAddress);
        }
        
        await db.updateAdminLastLogin(email);
        
        const admin = await db.getAdminByEmail(email);
        
        const sessionId = crypto.randomBytes(32).toString('hex');
        await db.createSession(sessionId, email, 24);
        
        console.log('[Admin Auth] Success:', email, admin.role);
        
        res.cookie('admin_session', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });
        
        res.json({
            success: true,
            admin: {
                email: admin.email,
                name: admin.name || name,
                role: admin.role,
                walletAddress: admin.wallet_address
            }
        });
        
    } catch (error) {
        console.error('[Admin Auth] Error:', error);
        res.status(500).json({ success: false, error: 'Authentication failed' });
    }
});

app.get('/api/admin/session', async (req, res) => {
    try {
        const sessionId = req.cookies?.admin_session;
        
        if (!sessionId) {
            return res.json({ authenticated: false });
        }
        
        const session = await db.getSession(sessionId);
        
        if (!session) {
            res.clearCookie('admin_session', { path: '/' });
            return res.json({ authenticated: false });
        }
        
        const admin = await db.getAdminByEmail(session.username);
        
        if (!admin) {
            res.clearCookie('admin_session', { path: '/' });
            return res.json({ authenticated: false });
        }
        
        res.json({
            authenticated: true,
            admin: {
                email: admin.email,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        console.error('[Admin Session] Error:', error);
        res.json({ authenticated: false });
    }
});

app.post('/api/admin/logout', async (req, res) => {
    const sessionId = req.cookies?.admin_session;
    if (sessionId) {
        await db.deleteSession(sessionId);
    }
    res.clearCookie('admin_session', { path: '/' });
    res.json({ success: true });
});

app.get('/api/admin/whitelist', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can view whitelist' });
        }
        const admins = await db.getAllAdmins();
        res.json({ success: true, admins });
    } catch (error) {
        console.error('Error getting admins:', error);
        res.status(500).json({ error: 'Failed to get admins' });
    }
});

app.post('/api/admin/whitelist', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can add admins' });
        }
        const { email, name, role } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const admin = await db.addAdmin(email, name, role || 'admin', req.admin.email);
        res.json({ success: true, admin });
    } catch (error) {
        console.error('Error adding admin:', error);
        res.status(500).json({ error: 'Failed to add admin' });
    }
});

app.delete('/api/admin/whitelist/:email', requireAdminAuth, async (req, res) => {
    try {
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admin can remove admins' });
        }
        await db.removeAdmin(req.params.email);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing admin:', error);
        res.status(500).json({ error: error.message || 'Failed to remove admin' });
    }
});
// ===========================================
// Wallet Connection API
// ===========================================
app.post('/api/wallet/connect', async (req, res) => {
    try {
        const { walletAddress, email, name, source } = req.body;

        console.log('[Wallet Connect] Received:', { walletAddress, email, name, source });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        const normalizedAddress = walletAddress.toLowerCase();
        let registrant = await db.getRegistrant(normalizedAddress);

        if (registrant) {
            if ((email && !registrant.email) || name) {
                try {
                    await db.pool.query(
                        `UPDATE registrants 
                         SET email = COALESCE($1, email),
                             metadata = jsonb_set(COALESCE(metadata, '{}'), '{name}', $2::jsonb),
                             updated_at = NOW() 
                         WHERE LOWER(address) = $3`,
                        [email || null, JSON.stringify(name || null), normalizedAddress]
                    );
                } catch (updateErr) {
                    console.error('[Wallet Connect] Update error:', updateErr.message);
                }
            }
            
            return res.json({
                success: true,
                action: 'updated',
                walletAddress: normalizedAddress,
                email: email || registrant.email
            });
        }

        try {
            await db.pool.query(
                `INSERT INTO registrants (address, email, source, metadata, registered_at, updated_at) 
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 ON CONFLICT (address) DO UPDATE SET 
                    email = COALESCE(EXCLUDED.email, registrants.email),
                    metadata = COALESCE(EXCLUDED.metadata, registrants.metadata),
                    updated_at = NOW()`,
                [normalizedAddress, email || null, source || 'wallettwo', JSON.stringify({ name: name || null })]
            );
        } catch (insertErr) {
            console.error('[Wallet Connect] Insert error:', insertErr.message);
        }

        return res.json({
            success: true,
            action: 'created',
            walletAddress: normalizedAddress,
            email: email
        });

    } catch (error) {
        console.error('[Wallet Connect] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to save wallet connection' });
    }
});

app.get('/api/wallet/info/:address', async (req, res) => {
    try {
        const { address } = req.params;

        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        const normalizedAddress = address.toLowerCase();
        const registrant = await db.getRegistrant(normalizedAddress);

        if (!registrant) {
            return res.json({
                success: true,
                exists: false,
                walletAddress: normalizedAddress
            });
        }

        res.json({
            success: true,
            exists: true,
            walletAddress: registrant.address,
            email: registrant.email,
            minted: registrant.minted,
            txHash: registrant.tx_hash,
            source: registrant.source,
            createdAt: registrant.registered_at
        });

    } catch (error) {
        console.error('[Wallet Info] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to get wallet info' });
    }
});

// ===========================================
// Public Claim API
// ===========================================
app.post('/api/claim/register', async (req, res) => {
    try {
        const { wallet_address, signature, message } = req.body;
        
        if (!wallet_address) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        const walletLower = wallet_address.toLowerCase();
        
        // Check current status
        const existing = await db.pool.query(
            'SELECT id, minted, tx_hash, tx_status FROM registrants WHERE wallet_address = $1',
            [walletLower]
        );
        
        if (existing.rows.length > 0) {
            const row = existing.rows[0];
            
            // If already confirmed, reject
            if (row.tx_status === 'confirmed') {
                return res.status(409).json({ 
                    success: false,
                    message: 'Already claimed',
                    tx_hash: row.tx_hash,
                    explorer_url: `https://polygonscan.com/tx/${row.tx_hash}`
                });
            }
            
            // If pending, don't allow another mint - tell user to wait
            if (row.tx_status === 'pending' && row.tx_hash) {
                return res.status(409).json({ 
                    success: false,
                    message: 'A claim is already in progress. Please wait for confirmation.',
                    tx_hash: row.tx_hash,
                    tx_status: 'pending',
                    explorer_url: `https://polygonscan.com/tx/${row.tx_hash}`
                });
            }
        }

        // Proceed with minting
        console.log(`🎯 Minting to: ${walletLower}`);
        
        // Set status to pending BEFORE minting
        await db.pool.query(`
            UPDATE registrants 
            SET tx_status = 'pending',
                updated_at = NOW()
            WHERE wallet_address = $1
        `, [walletLower]);

        try {
            // Start minting with a timeout wrapper
            const mintPromise = minter.mintTokens(walletLower);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), 5000)
            );
            
            let txHash = null;
            
            try {
                // Race between mint and 5-second timeout
                const mintResult = await Promise.race([mintPromise, timeoutPromise]);
                txHash = mintResult.tx_hash || mintResult.transactionHash || mintResult.hash;
                
                // If we got here quickly, tx might be confirmed
                const txStatus = mintResult.confirmed ? 'confirmed' : 'pending';
                
                await db.pool.query(`
                    UPDATE registrants 
                    SET minted = $2,
                        tx_hash = $3, 
                        tx_status = $4,
                        minted_at = NOW(),
                        updated_at = NOW()
                    WHERE wallet_address = $1
                `, [walletLower, txStatus === 'confirmed', txHash, txStatus]);
                
                return res.status(201).json({
                    success: true,
                    message: txStatus === 'confirmed' 
                        ? 'Tokens minted successfully!' 
                        : 'Tokens are being minted. Please check back shortly.',
                    tx_hash: txHash,
                    tx_status: txStatus,
                    explorer_url: `https://polygonscan.com/tx/${txHash}`
                });
                
            } catch (timeoutError) {
                if (timeoutError.message === 'TIMEOUT') {
                    // Timeout - but mint might still be in progress
                    // Let it continue in background, get tx hash if available
                    console.log('⏱️ Mint timeout, continuing in background...');
                    
                    // Try to get the tx hash from the ongoing promise
                    mintPromise.then(async (result) => {
                        txHash = result.tx_hash || result.transactionHash || result.hash;
                        console.log(`📋 Background mint completed, TX: ${txHash}`);
                        
                        await db.pool.query(`
                            UPDATE registrants 
                            SET tx_hash = $2,
                                tx_status = 'pending',
                                minted_at = NOW(),
                                updated_at = NOW()
                            WHERE wallet_address = $1
                        `, [walletLower, txHash]);
                    }).catch(err => {
                        console.error('Background mint failed:', err);
                        db.pool.query(`
                            UPDATE registrants 
                            SET tx_status = 'failed',
                                updated_at = NOW()
                            WHERE wallet_address = $1
                        `, [walletLower]);
                    });
                    
                    // Return immediately to user
                    return res.status(201).json({
                        success: true,
                        message: 'Tokens are being minted. This may take a few minutes.',
                        tx_status: 'pending',
                        tx_hash: null
                    });
                }
                throw timeoutError;
            }
            
        } catch (mintError) {
            console.error('Mint error:', mintError);
            
            // Update status to failed
            await db.pool.query(`
                UPDATE registrants 
                SET tx_status = 'failed',
                    updated_at = NOW()
                WHERE wallet_address = $1
            `, [walletLower]);
            
            return res.status(500).json({ 
                success: false, 
                error: 'Minting failed. Please try again.' 
            });
        }

    } catch (error) {
        console.error('Claim error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/claim/check-status/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        
        const result = await db.pool.query(
            'SELECT id, tx_hash, tx_status, minted, minted_at FROM registrants WHERE wallet_address = $1',
            [wallet]
        );
        
        if (result.rows.length === 0) {
            return res.json({ 
                success: true, 
                exists: false,
                claimed: false 
            });
        }
        
        const row = result.rows[0];
        
        // If already confirmed or no tx hash, return current status
        if (row.tx_status === 'confirmed' || !row.tx_hash) {
            return res.json({
                success: true,
                exists: true,
                claimed: row.tx_status === 'confirmed',
                tx_hash: row.tx_hash,
                tx_status: row.tx_status,
                explorer_url: row.tx_hash ? `https://polygonscan.com/tx/${row.tx_hash}` : null
            });
        }
        
        // If pending, check the blockchain
        if (row.tx_status === 'pending' && row.tx_hash) {
            try {
                const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC || 'https://polygon-rpc.com');
                const receipt = await provider.getTransactionReceipt(row.tx_hash);
                
                if (receipt) {
                    const newStatus = receipt.status === 1 ? 'confirmed' : 'failed';
                    const minted = receipt.status === 1;
                    
                    await db.pool.query(`
                        UPDATE registrants 
                        SET tx_status = $2, 
                            minted = $3,
                            updated_at = NOW()
                        WHERE id = $1
                    `, [row.id, newStatus, minted]);
                    
                    console.log(`✅ TX ${row.tx_hash} updated to ${newStatus}`);
                    
                    return res.json({
                        success: true,
                        exists: true,
                        claimed: minted,
                        tx_hash: row.tx_hash,
                        tx_status: newStatus,
                        explorer_url: `https://polygonscan.com/tx/${row.tx_hash}`
                    });
                }
                
                // Still pending - check timeout
                const mintedAt = new Date(row.minted_at);
                const minutesElapsed = (Date.now() - mintedAt.getTime()) / 1000 / 60;
                
                if (minutesElapsed > 30) {
                    // Mark as timeout
                    await db.pool.query(`
                        UPDATE registrants 
                        SET tx_status = 'timeout',
                            updated_at = NOW()
                        WHERE id = $1
                    `, [row.id]);
                    
                    return res.json({
                        success: true,
                        exists: true,
                        claimed: false,
                        tx_hash: row.tx_hash,
                        tx_status: 'timeout',
                        explorer_url: `https://polygonscan.com/tx/${row.tx_hash}`
                    });
                }
                
            } catch (rpcError) {
                console.error('RPC error checking tx:', rpcError.message);
            }
        }
        
        // Return current status
        return res.json({
            success: true,
            exists: true,
            claimed: row.minted,
            tx_hash: row.tx_hash,
            tx_status: row.tx_status,
            explorer_url: row.tx_hash ? `https://polygonscan.com/tx/${row.tx_hash}` : null
        });
        
    } catch (error) {
        console.error('Check status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/check-all-transactions', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, wallet_address, tx_hash, tx_status, minted_at 
            FROM registrants 
            WHERE tx_status = 'pending' 
            AND tx_hash IS NOT NULL
        `);
        
        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'No pending transactions', updated: 0 });
        }
        
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC || 'https://polygon-rpc.com');
        
        let confirmed = 0;
        let failed = 0;
        let timeout = 0;
        let stillPending = 0;
        
        for (const row of result.rows) {
            try {
                const receipt = await provider.getTransactionReceipt(row.tx_hash);
                
                if (receipt) {
                    if (receipt.status === 1) {
                        await db.pool.query(`
                            UPDATE registrants 
                            SET tx_status = 'confirmed', minted = true, updated_at = NOW()
                            WHERE id = $1
                        `, [row.id]);
                        confirmed++;
                        console.log(`✅ Confirmed: ${row.wallet_address}`);
                    } else {
                        await db.pool.query(`
                            UPDATE registrants 
                            SET tx_status = 'failed', minted = false, updated_at = NOW()
                            WHERE id = $1
                        `, [row.id]);
                        failed++;
                        console.log(`❌ Failed: ${row.wallet_address}`);
                    }
                } else {
                    // Check timeout
                    const minutesElapsed = (Date.now() - new Date(row.minted_at).getTime()) / 1000 / 60;
                    
                    if (minutesElapsed > 30) {
                        await db.pool.query(`
                            UPDATE registrants 
                            SET tx_status = 'timeout', updated_at = NOW()
                            WHERE id = $1
                        `, [row.id]);
                        timeout++;
                        console.log(`⏰ Timeout: ${row.wallet_address}`);
                    } else {
                        stillPending++;
                    }
                }
            } catch (err) {
                console.error(`Error checking ${row.tx_hash}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Transaction check completed',
            results: { confirmed, failed, timeout, stillPending },
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Admin check transactions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: Retry failed/timeout mints
app.post('/api/admin/retry-failed-mints', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, wallet_address, tx_hash
            FROM registrants 
            WHERE tx_status IN ('timeout', 'failed')
        `);
        
        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'No failed mints to retry', retried: 0 });
        }
        
        let retried = 0;
        let errors = [];
        
        for (const row of result.rows) {
            try {
                // Reset status
                await db.pool.query(`
                    UPDATE registrants 
                    SET tx_status = 'pending', tx_hash = NULL, updated_at = NOW()
                    WHERE id = $1
                `, [row.id]);
                
                // Attempt new mint
                const mintResult = await minter.mintTokens(row.wallet_address);
                const txHash = mintResult.tx_hash || mintResult.transactionHash || mintResult.hash;
                
                await db.pool.query(`
                    UPDATE registrants 
                    SET tx_hash = $2, minted_at = NOW(), updated_at = NOW()
                    WHERE id = $1
                `, [row.id, txHash]);
                
                retried++;
                console.log(`🔄 Retried mint for ${row.wallet_address}: ${txHash}`);
                
            } catch (err) {
                errors.push({ wallet: row.wallet_address, error: err.message });
                console.error(`Failed to retry ${row.wallet_address}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            message: `Retried ${retried} mints`,
            retried,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Retry failed mints error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/transactions', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                wallet_address,
                email,
                tx_hash,
                tx_status,
                minted,
                minted_at,
                registered_at
            FROM registrants 
            WHERE tx_hash IS NOT NULL OR tx_status != 'none'
            ORDER BY minted_at DESC NULLS LAST, registered_at DESC
        `);
        
        // Calculate stats
        const transactions = result.rows;
        const stats = {
            total: transactions.length,
            confirmed: transactions.filter(t => t.tx_status === 'confirmed').length,
            pending: transactions.filter(t => t.tx_status === 'pending').length,
            failed: transactions.filter(t => t.tx_status === 'failed').length,
            timeout: transactions.filter(t => t.tx_status === 'timeout').length
        };
        
        res.json({ transactions, stats });
    } catch (error) {
        console.error('Error loading transactions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Retry single mint
app.post('/api/admin/retry-single-mint', async (req, res) => {
    try {
        const { wallet_address } = req.body;
        
        if (!wallet_address) {
            return res.status(400).json({ error: 'Wallet address required' });
        }
        
        const walletLower = wallet_address.toLowerCase();
        
        // Reset status
        await db.pool.query(`
            UPDATE registrants 
            SET tx_status = 'pending', tx_hash = NULL, updated_at = NOW()
            WHERE wallet_address = $1
        `, [walletLower]);
        
        // Attempt mint
        const mintResult = await minter.mintTokens(walletLower);
        const txHash = mintResult.tx_hash || mintResult.transactionHash || mintResult.hash;
        
        // Update with new tx hash
        await db.pool.query(`
            UPDATE registrants 
            SET tx_hash = $2, minted_at = NOW(), updated_at = NOW()
            WHERE wallet_address = $1
        `, [walletLower, txHash]);
        
        res.json({ success: true, tx_hash: txHash });
    } catch (error) {
        console.error('Retry single mint error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/claim/status/:address', async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const normalizedAddress = address.toLowerCase();
    
    try {
        const registrant = await db.getRegistrant(normalizedAddress);
        
        let onChainBalance = '0';
        try {
            await minter.initialize();
            onChainBalance = await minter.getBalance(address);
        } catch (e) {
            console.error('Error checking on-chain balance:', e.message);
        }
        
        const networkConfig = getNetworkConfig();
        
        if (registrant) {
            res.json({
                registered: true,
                minted: registrant.minted,
                wallet_address: registrant.address,
                registered_at: registrant.registeredAt,
                minted_at: registrant.mintedAt,
                tx_hash: registrant.txHash,
                explorer_url: registrant.txHash && registrant.txHash !== 'ALREADY_HAD_TOKENS' && registrant.txHash !== 'pre-existing' && registrant.txHash !== 'skipped'
                    ? `${networkConfig.explorer}/tx/${registrant.txHash}`
                    : null,
                on_chain_balance: onChainBalance
            });
        } else if (parseFloat(onChainBalance) > 0) {
            res.json({
                registered: false,
                minted: true,
                wallet_address: normalizedAddress,
                on_chain_balance: onChainBalance,
                message: 'Wallet has tokens but was not registered through this system'
            });
        } else {
            res.json({
                registered: false,
                minted: false,
                wallet_address: normalizedAddress,
                on_chain_balance: '0'
            });
        }
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// ===========================================
// Admin Registrant Endpoints
// ===========================================
app.post('/api/register', requireAdminAuth, async (req, res) => {
    const { wallet_address } = req.body;
    
    if (!wallet_address || !validateAddress(wallet_address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        const normalizedAddress = wallet_address.toLowerCase();
        const existing = await db.hasRegistrant(normalizedAddress);
        if (existing) {
            return res.status(409).json({
                error: 'Wallet already registered',
                wallet_address: normalizedAddress
            });
        }
        
        const registrant = await db.addRegistrant(normalizedAddress, null, { source: 'admin' });
        
        res.status(201).json({
            success: true,
            wallet_address: normalizedAddress,
            message: 'Wallet registered successfully',
            registrant
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Failed to register wallet' });
    }
});

app.get('/api/registrants', requireAdminAuth, async (req, res) => {
    try {
        const registrants = await db.getAllRegistrants();
        res.json({ 
            success: true,
            registrants: registrants,
            count: registrants.length
        });
    } catch (error) {
        console.error('Error getting registrants:', error);
        res.status(500).json({ error: 'Failed to get registrants' });
    }
});

app.get('/api/registrants/pending', requireAdminAuth, async (req, res) => {
    try {
        const registrants = await db.getPendingRegistrants();
        res.json({ registrants });
    } catch (error) {
        console.error('Error getting pending registrants:', error);
        res.status(500).json({ error: 'Failed to fetch pending registrants' });
    }
});

app.get('/api/registrants/:address', requireAdminAuth, async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        const registrant = await db.getRegistrant(address.toLowerCase());
        if (registrant) {
            res.json(registrant);
        } else {
            res.status(404).json({ error: 'Wallet not found' });
        }
    } catch (error) {
        console.error('Error getting registrant:', error);
        res.status(500).json({ error: 'Failed to get registrant' });
    }
});

app.get('/api/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.getStats();
        const networkConfig = getNetworkConfig();
        
        res.json({
            total: stats.total || 0,
            minted: stats.minted || 0,
            pending: stats.pending || 0,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

app.get('/api/wallet-info', requireAdminAuth, async (req, res) => {
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const balance = await minter.provider.getBalance(minter.wallet.address);
        const balanceFormatted = ethers.formatEther(balance);
        
        res.json({
            address: minter.wallet.address,
            balance: balanceFormatted,
            currency: networkConfig.currency,
            network: networkConfig.name,
            tokenAddress: networkConfig.tokenAddress,
            tokenName: minter.tokenName,
            tokenSymbol: minter.tokenSymbol
        });
    } catch (error) {
        console.error('Wallet info error:', error);
        res.status(500).json({ error: 'Failed to get wallet info', details: error.message });
    }
});

app.get('/api/balance/:address', requireAdminAuth, async (req, res) => {
    const { address } = req.params;
    
    if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    try {
        await minter.initialize();
        const balance = await minter.getBalance(address);
        
        res.json({
            address,
            balance,
            symbol: minter.tokenSymbol || 'VIP'
        });
    } catch (error) {
        console.error('Balance error:', error);
        res.status(500).json({ error: 'Failed to check balance' });
    }
});

app.post('/api/mint-now', requireAdminAuth, async (req, res) => {
    console.log(' Manual mint requested via API...');
    
    try {
        const pending = await db.getPendingRegistrants();
        
        if (pending.length === 0) {
            return res.json({
                success: true,
                message: 'No pending registrants to mint',
                minted: 0
            });
        }
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        const MINT_AMOUNT = parseInt(process.env.MINT_AMOUNT) || 2;
        
        let mintedCount = 0;
        let skippedCount = 0;
        let lastTxHash = null;
        
        for (const registrant of pending) {
            try {
                const hasTokens = await minter.hasTokens(registrant.address);
                if (hasTokens) {
                    await db.markAsMinted(registrant.address, 'ALREADY_HAD_TOKENS');
                    skippedCount++;
                    continue;
                }
                
                const receipt = await minter.mintToAddress(registrant.address, MINT_AMOUNT);
                if (receipt && receipt.hash) {
                    await db.markAsMinted(registrant.address, receipt.hash);
                    lastTxHash = receipt.hash;
                    mintedCount++;
                }
            } catch (mintError) {
                console.error(`Failed to mint to ${registrant.address}:`, mintError.message);
            }
        }
        
        return res.json({
            success: true,
            minted: mintedCount,
            skipped: skippedCount,
            tx_hash: lastTxHash,
            explorer_url: lastTxHash ? `${networkConfig.explorer}/tx/${lastTxHash}` : null
        });
        
    } catch (error) {
        console.error('Mint error:', error);
        res.status(500).json({ error: 'Minting failed', details: error.message });
    }
});

app.post('/api/sync', requireAdminAuth, async (req, res) => {
    console.log(' Sync requested via API...');
    
    try {
        const pending = await db.getPendingRegistrants();
        
        if (pending.length === 0) {
            return res.json({
                success: true,
                message: 'No pending registrants to sync',
                synced: 0
            });
        }
        
        await minter.initialize();
        
        let synced = 0;
        
        for (const registrant of pending) {
            try {
                const hasTokens = await minter.hasTokens(registrant.address);
                if (hasTokens) {
                    await db.markAsMinted(registrant.address, 'ALREADY_HAD_TOKENS');
                    synced++;
                }
            } catch (error) {
                console.error(`Error checking ${registrant.address}:`, error.message);
            }
        }
        
        const stats = await db.getStats();
        
        res.json({
            success: true,
            synced,
            stillPending: pending.length - synced,
            stats
        });
        
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Sync failed', details: error.message });
    }
});

app.post('/api/full-sync', requireAdminAuth, async (req, res) => {
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';
        const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
        const minterAddress = minter.wallet?.address || process.env.MINTER_ADDRESS || '';
        
        const registrants = await db.getAllRegistrants();
        
        const results = {
            total: registrants.length,
            withBalance: 0,
            withoutBalance: 0,
            updated: 0,
            txHashesFound: 0,
            registrants: []
        };
        
        console.log(` Full sync starting for ${registrants.length} registrants...`);
        
        for (const registrant of registrants) {
            try {
                const balance = await minter.getBalance(registrant.address);
                const hasBalance = parseFloat(balance) > 0;
                
                if (hasBalance) {
                    results.withBalance++;
                } else {
                    results.withoutBalance++;
                }
                
                let txHash = registrant.tx_hash;
                let needsUpdate = false;
                
                const hasValidTxHash = txHash && 
                    txHash !== 'synced-from-chain' && 
                    txHash !== 'ALREADY_HAD_TOKENS' && 
                    txHash !== 'pre-existing' && 
                    txHash !== 'skipped' &&
                    txHash.startsWith('0x');
                
                if (hasBalance && !hasValidTxHash) {
                    try {
                        const apiUrl = `${POLYGONSCAN_API}?module=account&action=tokentx` +
                            `&contractaddress=${VIP_TOKEN_ADDRESS}` +
                            `&address=${registrant.address}` +
                            `&page=1&offset=100&sort=desc` +
                            (POLYGONSCAN_API_KEY ? `&apikey=${POLYGONSCAN_API_KEY}` : '');
                        
                        const response = await fetch(apiUrl);
                        const data = await response.json();
                        
                        if (data.status === '1' && data.result && data.result.length > 0) {
                            let mintTx = null;
                            
                            if (minterAddress) {
                                mintTx = data.result.find(tx => 
                                    tx.from.toLowerCase() === minterAddress.toLowerCase() &&
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            if (!mintTx) {
                                mintTx = data.result.find(tx => 
                                    tx.to.toLowerCase() === registrant.address.toLowerCase()
                                );
                            }
                            
                            if (mintTx && mintTx.hash) {
                                txHash = mintTx.hash;
                                results.txHashesFound++;
                                needsUpdate = true;
                            }
                        }
                    } catch (apiError) {
                        console.error(`Polygonscan API error for ${registrant.address}:`, apiError.message);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                
                if (hasBalance && !registrant.minted) {
                    await db.markAsMinted(registrant.address, txHash || 'synced-from-chain');
                    results.updated++;
                } else if (needsUpdate && txHash) {
                    await db.markAsMinted(registrant.address, txHash);
                    results.updated++;
                }
                
                results.registrants.push({
                    address: registrant.address,
                    email: registrant.email,
                    balance: balance,
                    minted: hasBalance || registrant.minted,
                    txHash: txHash || registrant.tx_hash,
                    registeredAt: registrant.registered_at
                });
                
            } catch (regError) {
                console.error(`Error processing ${registrant.address}:`, regError.message);
                results.registrants.push({
                    address: registrant.address,
                    email: registrant.email,
                    balance: 'error',
                    minted: registrant.minted,
                    txHash: registrant.tx_hash,
                    registeredAt: registrant.registered_at,
                    error: regError.message
                });
            }
        }
        
        const stats = await db.getStats();
        
        console.log(` Full sync completed: ${results.updated} updated, ${results.txHashesFound} TX hashes found`);
        
        res.json({
            success: true,
            message: `Full sync completed. Updated ${results.updated} records.`,
            results,
            stats,
            network: networkConfig.name,
            explorer: networkConfig.explorer
        });
        
    } catch (error) {
        console.error(' Full sync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/mint-manual', requireAdminAuth, async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        const normalizedAddress = address.toLowerCase();
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        const mintAmount = parseInt(process.env.MINT_AMOUNT) || 2;
        
        const currentBalance = await minter.getBalance(normalizedAddress);
        if (parseFloat(currentBalance) >= mintAmount) {
            return res.json({
                success: false,
                message: `Wallet already has ${currentBalance} tokens`,
                address: normalizedAddress,
                balance: currentBalance
            });
        }
        
        console.log(` Manual minting ${mintAmount} tokens to ${normalizedAddress}`);
        const result = await minter.mintToAddress(normalizedAddress, mintAmount);
        
        if (result.skipped) {
            return res.json({
                success: false,
                message: result.reason || 'Minting skipped',
                address: normalizedAddress
            });
        }
        
        const txHash = result.receipt?.hash || result.hash;
        
        let registrant = await db.getRegistrant(normalizedAddress);
        if (!registrant) {
            await db.addRegistrant(normalizedAddress, null, { source: 'manual-mint' });
        }
        await db.markAsMinted(normalizedAddress, txHash);
        
        console.log(` Manual mint successful: ${txHash}`);
        
        res.json({
            success: true,
            message: `Successfully minted ${mintAmount} tokens`,
            address: normalizedAddress,
            amount: mintAmount,
            tx_hash: txHash,
            explorer_url: `${networkConfig.explorer}/tx/${txHash}`
        });
        
    } catch (error) {
        console.error(' Manual mint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ===========================================
// Presale API Endpoints
// ===========================================

// Get presale config (public)
app.get('/api/presale/config', async (req, res) => {
    try {
        let dbConfig = {};
        try {
            const configResult = await db.pool.query('SELECT * FROM presale_config WHERE id = 1');
            if (configResult.rows.length > 0) {
                dbConfig = configResult.rows[0];
            }
        } catch (dbErr) {
            console.log('Ã‚Â  Could not load presale_config from DB:', dbErr.message);
        }
        
        PRESALE_CONFIG.saleTargetEUR = parseFloat(dbConfig.sale_target_eur) || PRESALE_CONFIG.saleTargetEUR || 500000;
        PRESALE_CONFIG.tokenPrice = parseFloat(dbConfig.token_price) || PRESALE_CONFIG.tokenPrice || 1.00;
        PRESALE_CONFIG.minPurchase = parseFloat(dbConfig.min_purchase) || PRESALE_CONFIG.minPurchase || 10;
        PRESALE_CONFIG.presaleWallet = dbConfig.presale_wallet || PRESALE_CONFIG.presaleWallet;
        PRESALE_CONFIG.presaleEnabled = dbConfig.presale_enabled !== false;
        PRESALE_CONFIG.totalTokens = parseFloat(dbConfig.total_tokens) || PRESALE_CONFIG.totalTokens || 1000000;
        
        let eurRaised = 0;
        let tokensSold = 0;
        try {
            const result = await db.pool.query(`
                SELECT 
                    COALESCE(SUM(net_amount), 0) as eur_raised,
                    COALESCE(SUM(token_amount), 0) as tokens_sold
                FROM presale_purchases 
                WHERE status IN ('completed', 'minted')
            `);
            if (result.rows.length > 0) {
                eurRaised = parseFloat(result.rows[0].eur_raised) || 0;
                tokensSold = parseFloat(result.rows[0].tokens_sold) || 0;
            }
        } catch (dbErr) {
            console.error(' Failed to get sales from DB:', dbErr.message);
        }
        
        let eurUsdRate = 1.19;
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            const rateData = await rateRes.json();
            eurUsdRate = rateData.rates?.USD || 1.19;
        } catch (e) {
            console.log('Ã‚Â  Using fallback EUR/USD rate:', eurUsdRate);
        }
        
        let polPrice = 0.12;
        try {
            const polRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=polygon-ecosystem-token&vs_currencies=usd');
            const polData = await polRes.json();
            polPrice = polData['polygon-ecosystem-token']?.usd || 0.12;
        } catch (e) {
            console.log('Ã‚Â  Using fallback POL price:', polPrice);
        }

        const saleTargetEUR = PRESALE_CONFIG.saleTargetEUR || 500000;
        const progressPct = ((eurRaised / saleTargetEUR) * 100);

        res.json({
            eurRaised: eurRaised,
            saleTargetEUR: saleTargetEUR,
            progressPct: parseFloat(progressPct.toFixed(2)),
            tokensSold: tokensSold,
            totalTokens: PRESALE_CONFIG.totalTokens || 1000000,
            tokenPrice: PRESALE_CONFIG.tokenPrice || 1.00,
            eurUsdRate: eurUsdRate,
            polPrice: polPrice,
            presaleEnabled: PRESALE_CONFIG.presaleEnabled !== false,
            presaleWallet: PRESALE_CONFIG.presaleWallet,
            minPurchase: PRESALE_CONFIG.minPurchase || 10,
            maxPurchase: PRESALE_CONFIG.maxPurchase || 10000,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY
        });
    } catch (error) {
        console.error(' Config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create Payment Intent for Stripe Elements
app.post('/api/presale/create-payment-intent', async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ error: 'Card payments not available' });
    }
    
    try {
        const { walletAddress, tokenAmount, email } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!tokenAmount || tokenAmount < PRESALE_CONFIG.minPurchase || tokenAmount > PRESALE_CONFIG.maxPurchase) {
            return res.status(400).json({ 
                error: `Token amount must be between ${PRESALE_CONFIG.minPurchase} and ${PRESALE_CONFIG.maxPurchase}` 
            });
        }
        
        const normalizedAddress = walletAddress.toLowerCase();
        const baseEUR = tokenAmount * PRESALE_CONFIG.tokenPrice;
        
        const stripeFeePercent = 3;
        const platformFeePercent = 1;
        const totalFeePercent = stripeFeePercent + platformFeePercent;
        
        const feeEUR = baseEUR * (totalFeePercent / 100);
        const totalEUR = baseEUR + feeEUR;
        const amountCents = Math.round(totalEUR * 100);
        
        const platformFeeCents = Math.round(feeEUR * 100);
        const connectedAccountCents = amountCents - platformFeeCents;
        
        console.log(' Creating Payment Intent:', { 
            wallet: normalizedAddress, 
            tokens: tokenAmount, 
            total: `{totalEUR.toFixed(2)}`
        });
        
        const paymentIntentConfig = {
            amount: amountCents,
            currency: 'eur',
            payment_method_types: ['card'],
            metadata: {
                walletAddress: normalizedAddress,
                tokenAmount: tokenAmount.toString(),
                baseAmount: baseEUR.toFixed(2),
                feeAmount: feeEUR.toFixed(2),
                feePercent: totalFeePercent.toString(),
                source: 'presale'
            },
            receipt_email: email || undefined,
            description: `${tokenAmount} VIP Tokens - Kea Valley Presale`
        };
        
        if (process.env.STRIPE_DESTINATION_ACCOUNT) {
            paymentIntentConfig.transfer_data = {
                destination: process.env.STRIPE_DESTINATION_ACCOUNT,
                amount: connectedAccountCents
            };
        }
        
        const paymentIntent = await stripe.paymentIntents.create(paymentIntentConfig);
        
        console.log(' Payment Intent created:', paymentIntent.id);
        
        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            baseAmount: baseEUR,
            feeAmount: feeEUR,
            feePercent: totalFeePercent,
            totalAmount: totalEUR,
            currency: 'EUR'
        });
        
    } catch (error) {
        console.error(' Payment Intent error:', error);
        res.status(500).json({ error: 'Failed to create payment' });
    }
});

// Get purchase status
app.get('/api/presale/purchase-status/:paymentIntentId', async (req, res) => {
    try {
        const { paymentIntentId } = req.params;
        
        const result = await db.pool.query(
            `SELECT status, mint_tx_hash, token_amount, error_message 
             FROM presale_purchases 
             WHERE stripe_payment_intent = $1 OR payment_tx_hash = $1`,
            [paymentIntentId]
        );
        
        if (result.rows.length === 0) {
            return res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
        }
        
        const purchase = result.rows[0];
        res.json({
            status: purchase.status,
            mintTxHash: purchase.mint_tx_hash,
            tokenAmount: purchase.token_amount,
            error: purchase.error_message
        });
    } catch (error) {
        console.error(' Purchase status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Admin Manual Mint (Cash/Direct Transfers)
// ===========================================
app.post('/api/presale/admin/manual-mint', requireAdminAuth, async (req, res) => {
    console.log(' Manual mint endpoint hit');
    
    try {
        const { walletAddress, eurAmount } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        if (!eurAmount || eurAmount <= 0) {
            return res.status(400).json({ error: 'Invalid EUR amount' });
        }
        
        const normalizedAddress = walletAddress.toLowerCase();
        const tokenPrice = PRESALE_CONFIG.tokenPrice || 1.00;
        const calculatedTokens = eurAmount / tokenPrice;
        const platformFee = eurAmount * 0.01;
        const feeCents = Math.round(platformFee * 100);
        
        console.log(` Manual mint request: ${calculatedTokens} VIP to ${normalizedAddress}`);
        
        let stripeTransferId = null;
        
        // Only process Stripe fee transfer if configured
        if (stripe && process.env.STRIPE_DESTINATION_ACCOUNT && process.env.STRIPE_ACCOUNT_ID) {
            console.log(` Checking connected account balance...`);
            
            let availableCents = 0;
            try {
                const balance = await stripe.balance.retrieve({
                    stripeAccount: process.env.STRIPE_DESTINATION_ACCOUNT
                });
                
                const eurBalance = balance.available.find(b => b.currency === 'eur');
                availableCents = eurBalance ? eurBalance.amount : 0;
                
                console.log(` Connected account EUR balance: {(availableCents / 100).toFixed(2)}`);
            } catch (balanceError) {
                console.error(` Balance check failed:`, balanceError.message);
                return res.status(500).json({ error: 'Failed to check connected account balance' });
            }
            
            if (availableCents < feeCents) {
                console.error(` Insufficient balance: need {platformFee.toFixed(2)}, have {(availableCents / 100).toFixed(2)}`);
                return res.status(400).json({ 
                    error: 'Insufficient balance in connected account',
                    required: platformFee,
                    available: availableCents / 100
                });
            }
            
            console.log(` Transferring {platformFee.toFixed(2)} from connected account to platform...`);
            
            try {
                const transfer = await stripe.transfers.create({
                    amount: feeCents,
                    currency: 'eur',
                    destination: process.env.STRIPE_ACCOUNT_ID,
                    description: `Manual mint fee - ${calculatedTokens} VIP to ${normalizedAddress.slice(0, 8)}...`,
                    metadata: {
                        type: 'manual_mint_fee',
                        walletAddress: normalizedAddress,
                        tokenAmount: calculatedTokens.toString(),
                        eurAmount: eurAmount.toString()
                    }
                }, {
                    stripeAccount: process.env.STRIPE_DESTINATION_ACCOUNT
                });
                
                stripeTransferId = transfer.id;
                console.log(` Fee transferred: ${stripeTransferId}`);
            } catch (transferError) {
                console.error(` Fee transfer failed:`, transferError.message);
                return res.status(500).json({ error: 'Fee transfer failed: ' + transferError.message });
            }
        } else {
            console.log('Ã‚Â  Stripe not configured for fee transfer, proceeding without');
        }
        
        // Get EUR/USD rate
        let eurUsdRate = 1.19;
        try {
            const rateRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
            const rateData = await rateRes.json();
            eurUsdRate = rateData.rates?.USD || 1.19;
        } catch (e) {
            console.log('Ã‚Â  Using default EUR/USD rate: 1.19');
        }
        
        const usdAmount = eurAmount * eurUsdRate;
        
        // Record purchase
        console.log(` Recording purchase in DB...`);
        const purchaseResult = await db.pool.query(`
            INSERT INTO presale_purchases 
            (wallet_address, token_amount, payment_amount, eur_amount, usd_amount, payment_method, platform_fee, status, stripe_transfer_id, created_at)
            VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'pending', $7, NOW())
            RETURNING id
        `, [normalizedAddress, calculatedTokens, eurAmount, eurAmount, usdAmount, platformFee, stripeTransferId]);
        
        const purchaseId = purchaseResult.rows[0].id;
        console.log(` Purchase recorded: ID ${purchaseId}`);
        
        // Mint tokens
        console.log(` Initializing minter...`);
        await minter.initialize();
        
        console.log(` Minting ${calculatedTokens} VIP to ${normalizedAddress}...`);
        const mintResult = await minter.mintToAddress(normalizedAddress, parseFloat(calculatedTokens), true);
        
        if (!mintResult.success && !mintResult.txHash && !mintResult.receipt) {
            console.error(` Mint failed:`, mintResult.error);
            await db.pool.query(`UPDATE presale_purchases SET status = 'mint_failed' WHERE id = $1`, [purchaseId]);
            return res.status(500).json({ 
                error: 'Minting failed', 
                details: mintResult.error,
                stripeTransferId,
                needsRefund: !!stripeTransferId
            });
        }
        
        const mintTxHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash;
        console.log(` Minted! TX: ${mintTxHash}`);
        
        // Update purchase
        await db.pool.query(`
            UPDATE presale_purchases 
            SET mint_tx_hash = $1, status = 'completed', minted_at = NOW()
            WHERE id = $2
        `, [mintTxHash, purchaseId]);
        
        // Update presale config
        try {
            await db.pool.query(`
                UPDATE presale_config 
                SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                    eur_raised = COALESCE(eur_raised, 0) + $2,
                    updated_at = NOW() 
                WHERE id = 1
            `, [parseFloat(calculatedTokens), eurAmount]);
            console.log(`Ã‚Â  PRESALE CONFIG UPDATED: +${calculatedTokens} tokens sold`);
        } catch (configError) {
            console.error('Ã‚Â  Failed to update presale_config:', configError.message);
        }
        
        // Process referral bonus
        let referralBonusTx = null;
        let referralBonusAmount = 0;
        
        try {
            const referralResult = await db.pool.query(`
                SELECT r.referrer_wallet, r.referrer_code, rc.owner_wallet
                FROM referrals r
                LEFT JOIN referral_codes rc ON r.referrer_code = rc.code
                WHERE r.referred_wallet = $1
            `, [normalizedAddress]);
            
            if (referralResult.rows.length > 0) {
                const row = referralResult.rows[0];
                const referrerWallet = row.referrer_wallet || row.owner_wallet;
                const referrerCode = row.referrer_code;
                
                if (referrerWallet) {
                    const settingsResult = await db.pool.query(`
                        SELECT * FROM referral_settings WHERE id = 1
                    `);
                    
                    const settings = settingsResult.rows[0] || {};
                    const minPurchase = parseFloat(settings.min_purchase_for_bonus) || 0;
                    
                    if (settings.enabled && eurAmount >= minPurchase) {
                        const bonusType = settings.presale_bonus_type || 'percentage';
                        const bonusValue = parseFloat(settings.presale_bonus_amount) || 5;
                        
                        referralBonusAmount = bonusType === 'percentage'
                            ? (calculatedTokens * bonusValue) / 100
                            : bonusValue;
                        
                        if (referralBonusAmount > 0) {
                            console.log(` Minting referral bonus to ${referrerWallet}...`);
                            
                            const bonusMintResult = await minter.mintToAddress(
                                referrerWallet.toLowerCase(), 
                                referralBonusAmount, 
                                true
                            );
                            
                            if (bonusMintResult.success || bonusMintResult.txHash || bonusMintResult.receipt) {
                                referralBonusTx = bonusMintResult.txHash || bonusMintResult.receipt?.hash;
                                console.log(` Referral bonus TX: ${referralBonusTx}`);
                                
                                await db.pool.query(`
                                    UPDATE referrals 
                                    SET presale_bonus_paid = COALESCE(presale_bonus_paid, 0) + $1
                                    WHERE referred_wallet = $2
                                `, [referralBonusAmount, normalizedAddress]);
                                
                                await db.pool.query(`
                                    UPDATE referral_codes 
                                    SET total_bonus_earned = COALESCE(total_bonus_earned, 0) + $1,
                                        total_presale_purchases = COALESCE(total_presale_purchases, 0) + 1,
                                        updated_at = NOW()
                                    WHERE code = $2
                                `, [referralBonusAmount, referrerCode]);
                            }
                        }
                    }
                }
            }
        } catch (refError) {
            console.error('Ã‚Â  Referral error (non-fatal):', refError.message);
        }
        
        console.log(` Manual mint complete!`);
        
        const networkConfig = getNetworkConfig();
        return res.json({
            success: true,
            purchaseId,
            txHash: mintTxHash,
            tokenAmount: calculatedTokens,
            eurAmount,
            platformFee,
            stripeTransferId,
            explorer_url: `${networkConfig.explorer}/tx/${mintTxHash}`,
            referralBonus: referralBonusAmount > 0 ? {
                amount: referralBonusAmount,
                txHash: referralBonusTx
            } : null
        });
        
    } catch (error) {
        console.error(' Manual mint error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// Get manual mints list
app.get('/api/presale/admin/manual-mints', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, wallet_address, token_amount, eur_amount, usd_amount, 
                   mint_tx_hash, status, created_at
            FROM presale_purchases 
            WHERE payment_method = 'manual'
            ORDER BY created_at DESC
            LIMIT 50
        `);
        
        res.json({ mints: result.rows });
        
    } catch (error) {
        console.error('Load manual mints error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Fee summary for cash payments
app.get('/api/presale/admin/fee-summary', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                COUNT(*) as total_cash_purchases,
                COALESCE(SUM(token_amount), 0) as total_tokens,
                COALESCE(SUM(eur_amount), 0) as total_eur,
                COALESCE(SUM(platform_fee), 0) as total_fees_owed,
                COALESCE(SUM(CASE WHEN stripe_fee > 0 THEN platform_fee ELSE 0 END), 0) as total_fees_settled
            FROM presale_purchases
            WHERE payment_method IN ('cash', 'bank_transfer', 'manual')
            AND status = 'completed'
        `);
        
        const summary = result.rows[0];
        
        res.json({
            success: true,
            summary: {
                totalCashPurchases: parseInt(summary.total_cash_purchases),
                totalTokens: parseFloat(summary.total_tokens),
                totalEur: parseFloat(summary.total_eur),
                totalFeesOwed: parseFloat(summary.total_fees_owed),
                totalFeesSettled: parseFloat(summary.total_fees_settled),
                feesOutstanding: parseFloat(summary.total_fees_owed) - parseFloat(summary.total_fees_settled)
            }
        });
    } catch (error) {
        console.error(' Fee summary error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===========================================
// Referral System Endpoints
// ===========================================

// Get referral code info for wallet
app.get('/api/referral/code/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet || !ethers.isAddress(wallet)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        const result = await db.pool.query(
            'SELECT * FROM referral_codes WHERE LOWER(owner_wallet) = $1',
            [wallet.toLowerCase()]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: true, hasCode: false });
        }
        
        const code = result.rows[0];
        
        const referrals = await db.pool.query(
            `SELECT referred_wallet, referred_email, source, bonus_amount, bonus_paid, created_at
             FROM referral_tracking
             WHERE referral_code = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [code.code]
        );
        
        res.json({
            success: true,
            hasCode: true,
            referralCode: code.code,
            enabled: code.enabled,
            stats: {
                totalReferrals: code.total_referrals,
                totalClaims: code.total_claims,
                totalPresalePurchases: code.total_presale_purchases,
                totalBonusEarned: parseFloat(code.total_bonus_earned) || 0
            },
            recentReferrals: referrals.rows
        });
        
    } catch (error) {
        console.error('[Referral] Get code error:', error);
        res.status(500).json({ success: false, error: 'Failed to get referral code' });
    }
});

// Validate referral code
app.get('/api/referral/validate/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        if (!code || code.length < 6) {
            return res.json({ success: true, valid: false });
        }
        
        const settings = await getReferralSettings();
        
        if (!settings.enabled) {
            return res.json({ success: true, valid: false, reason: 'Referral program disabled' });
        }
        
        const result = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1) AND enabled = true',
            [code]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: true, valid: false, reason: 'Code not found or disabled' });
        }
        
        res.json({
            success: true,
            valid: true,
            referrerWallet: result.rows[0].owner_wallet
        });
        
    } catch (error) {
        console.error('[Referral] Validate error:', error);
        res.json({ success: true, valid: false });
    }
});

// Track referral
app.post('/api/referral/track', async (req, res) => {
    try {
        const { referralCode, referredWallet, referredEmail, source, purchaseAmount } = req.body;
        
        if (!referralCode || !referredWallet) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const settings = await getReferralSettings();
        
        if (!settings.enabled) {
            return res.json({ success: false, error: 'Referral program disabled' });
        }
        
        const codeResult = await db.pool.query(
            'SELECT * FROM referral_codes WHERE UPPER(code) = UPPER($1) AND enabled = true',
            [referralCode]
        );
        
        if (codeResult.rows.length === 0) {
            return res.json({ success: false, error: 'Invalid referral code' });
        }
        
        const referrerWallet = codeResult.rows[0].owner_wallet;
        
        if (referredWallet.toLowerCase() === referrerWallet.toLowerCase()) {
            return res.json({ success: false, error: 'Cannot use own referral code' });
        }
        
        const existingReferral = await db.pool.query(
            'SELECT id FROM referral_tracking WHERE LOWER(referred_wallet) = $1 AND source = $2',
            [referredWallet.toLowerCase(), source]
        );
        
        if (existingReferral.rows.length > 0) {
            return res.json({ success: false, error: 'Wallet already referred for this action' });
        }
        
        let bonusType, bonusAmount;
        if (source === 'claim') {
            bonusType = settings.bonusType;
            bonusAmount = settings.bonusAmount;
        } else if (source === 'presale') {
            bonusType = settings.presaleBonusType;
            if (bonusType === 'percentage' && purchaseAmount) {
                bonusAmount = (purchaseAmount * settings.presaleBonusAmount) / 100;
            } else {
                bonusAmount = settings.presaleBonusAmount;
            }
        }
        
        await db.pool.query(
            `INSERT INTO referral_tracking 
             (referral_code, referred_wallet, referred_email, referrer_wallet, source, bonus_type, bonus_amount, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [referralCode.toUpperCase(), referredWallet.toLowerCase(), referredEmail, referrerWallet, source, bonusType, bonusAmount]
        );
        
        const updateField = source === 'claim' ? 'total_claims' : 'total_presale_purchases';
        await db.pool.query(
            `UPDATE referral_codes 
             SET total_referrals = total_referrals + 1,
                 ${updateField} = ${updateField} + 1,
                 total_bonus_earned = total_bonus_earned + $1,
                 updated_at = NOW()
             WHERE UPPER(code) = UPPER($2)`,
            [bonusAmount, referralCode]
        );
        
        res.json({
            success: true,
            bonusAmount,
            bonusType,
            referrerWallet
        });
        
    } catch (error) {
        console.error('[Referral] Track error:', error);
        res.status(500).json({ success: false, error: 'Failed to track referral' });
    }
});

// Get referral settings (public)
app.get('/api/referral/settings', async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM referral_settings WHERE id = 1');
        
        if (result.rows.length === 0) {
            return res.json({
                enabled: false,
                bonusType: 'fixed',
                bonusAmount: 5,
                presaleBonusType: 'percentage',
                presaleBonusAmount: 5,
                minPurchaseForBonus: 10
            });
        }
        
        const settings = result.rows[0];
        res.json({
            enabled: settings.enabled,
            bonusType: settings.bonus_type,
            bonusAmount: parseFloat(settings.bonus_amount) || 0,
            presaleBonusType: settings.presale_bonus_type,
            presaleBonusAmount: parseFloat(settings.presale_bonus_amount) || 0,
            minPurchaseForBonus: parseFloat(settings.min_purchase_for_bonus) || 10
        });
    } catch (error) {
        console.error('Error fetching referral settings:', error);
        res.status(500).json({ error: 'Failed to fetch referral settings' });
    }
});

// Update referral settings (admin)
app.post('/api/referral/settings', requireAdminAuth, async (req, res) => {
    try {
        const { enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus } = req.body;
        
        console.log(' Saving referral settings:', { enabled, bonusType, bonusAmount });
        
        const result = await db.pool.query(`
            UPDATE referral_settings 
            SET enabled = $1, 
                bonus_type = $2, 
                bonus_amount = $3, 
                presale_bonus_type = $4, 
                presale_bonus_amount = $5,
                min_purchase_for_bonus = $6, 
                updated_at = NOW()
            WHERE id = 1
            RETURNING *
        `, [enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus]);
        
        if (result.rows.length === 0) {
            await db.pool.query(`
                INSERT INTO referral_settings (id, enabled, bonus_type, bonus_amount, presale_bonus_type, presale_bonus_amount, min_purchase_for_bonus, updated_at)
                VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
            `, [enabled, bonusType, bonusAmount, presaleBonusType, presaleBonusAmount, minPurchaseForBonus]);
        }
        
        console.log(' Referral settings saved');
        res.json({ success: true, message: 'Referral settings updated' });
    } catch (error) {
        console.error(' Error updating referral settings:', error);
        res.status(500).json({ error: 'Failed to update referral settings', details: error.message });
    }
});

app.post('/api/admin/presale/fulfill-all', requireAdminAuth, async (req, res) => {
  try {
    const pending = await db.pool.query(
      `SELECT id, wallet_address, token_amount, purchase_bonus_tokens 
       FROM presale_purchases 
       WHERE status IN ('paid', 'pending_mint') 
       ORDER BY created_at ASC 
       LIMIT 50`
    );

    if (pending.rows.length === 0) {
      return res.json({ success: true, message: 'No pending orders to fulfill', fulfilled: 0 });
    }

    const minter = require('./minter');
    await minter.initialize();

    let fulfilled = 0;
    let failed = 0;
    const results = [];

    for (const p of pending.rows) {
      try {
        const totalTokens = parseFloat(p.token_amount) + (parseFloat(p.purchase_bonus_tokens) || 0);
        const mintResult = await minter.mintToAddress(p.wallet_address, totalTokens, true);

        if (mintResult.success) {
          const mintTxHash = mintResult.txHash || mintResult.receipt?.hash;
          await db.pool.query(
            `UPDATE presale_purchases 
             SET status = 'completed', mint_tx_hash = $1, minted_at = NOW(), updated_at = NOW() 
             WHERE id = $2`,
            [mintTxHash, p.id]
          );
          await db.pool.query(
            `UPDATE presale_config SET tokens_sold = tokens_sold + $1, updated_at = NOW() WHERE id = 1`,
            [totalTokens]
          );
          fulfilled++;
          results.push({ id: p.id, success: true, txHash: mintTxHash });
        } else {
          failed++;
          results.push({ id: p.id, success: false, error: mintResult.error });
        }
      } catch (e) {
        failed++;
        results.push({ id: p.id, success: false, error: e.message });
      }
    }

    res.json({ success: true, fulfilled, failed, total: pending.rows.length, results });

  } catch (error) {
    console.error('Batch fulfill error:', error);
    res.status(500).json({ error: 'Failed to fulfill orders' });
  }
});

// Get referral status for wallet
app.get('/api/referral/status/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        if (!wallet || !ethers.isAddress(wallet)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        const normalizedAddress = wallet.toLowerCase();

        const settingsResult = await db.pool.query(
            'SELECT * FROM referral_settings WHERE id = 1'
        );
        
        const settings = settingsResult.rows[0] || { enabled: false };
        const programEnabled = settings.enabled === true;

        const registrantResult = await db.pool.query(
            'SELECT referrer_wallet, referrer_code, referrer_set_at FROM registrants WHERE address = $1',
            [normalizedAddress]
        );
        
        const registrant = registrantResult.rows[0];
        const hasReferrer = !!(registrant?.referrer_wallet);

        const codeResult = await db.pool.query(
            'SELECT code, enabled, created_at, total_referrals, total_bonus_earned FROM referral_codes WHERE owner_wallet = $1',
            [normalizedAddress]
        );
        
        const myCodeData = codeResult.rows[0];

        res.json({
            hasReferrer,
            referrerWallet: registrant?.referrer_wallet || null,
            referrerCode: registrant?.referrer_code || null,
            referrerSetAt: registrant?.referrer_set_at || null,
            myCode: myCodeData?.code || null,
            myCodeEnabled: myCodeData?.enabled ?? null,
            myCodeCreatedAt: myCodeData?.created_at || null,
            stats: {
                totalReferrals: myCodeData?.total_referrals || 0,
                totalBonusEarned: parseFloat(myCodeData?.total_bonus_earned) || 0
            },
            programEnabled,
            bonusInfo: {
                signupType: settings.bonus_type || 'fixed',
                signupAmount: parseFloat(settings.bonus_amount) || 0,
                presaleType: settings.presale_bonus_type || 'percentage',
                presaleAmount: parseFloat(settings.presale_bonus_amount) || 0
            }
        });

    } catch (error) {
        console.error(' Referral status error:', error.message);
        res.status(500).json({ error: 'Failed to get referral status' });
    }
});
// Set referrer for user (one-time)
app.post('/api/referral/set', async (req, res) => {
    try {
        const { walletAddress, referralCode } = req.body;
        
        console.log('\nÃƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â SET REFERRER:', { walletAddress, referralCode });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        if (!referralCode || referralCode.length < 6) {
            return res.status(400).json({ success: false, error: 'Invalid referral code' });
        }

        const normalizedAddress = walletAddress.toLowerCase();
        const code = referralCode.toUpperCase();

        const settingsResult = await db.pool.query(
            'SELECT * FROM referral_settings WHERE id = 1'
        );
        
        if (!settingsResult.rows[0]?.enabled) {
            return res.status(400).json({ success: false, error: 'Referral program is currently disabled' });
        }

        const settings = settingsResult.rows[0];

        const existingReferrer = await db.pool.query(
            'SELECT referrer_wallet FROM registrants WHERE address = $1 AND referrer_wallet IS NOT NULL',
            [normalizedAddress]
        );

        if (existingReferrer.rows.length > 0 && existingReferrer.rows[0].referrer_wallet) {
            return res.status(400).json({ success: false, error: 'You already have a referrer set. This cannot be changed.' });
        }

        const codeResult = await db.pool.query(
            'SELECT owner_wallet, enabled FROM referral_codes WHERE code = $1',
            [code]
        );

        if (codeResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid referral code' });
        }

        const referrerWallet = codeResult.rows[0].owner_wallet;

        if (!codeResult.rows[0].enabled) {
            return res.status(400).json({ success: false, error: 'This referral code is no longer active' });
        }

        if (referrerWallet.toLowerCase() === normalizedAddress) {
            return res.status(400).json({ success: false, error: 'You cannot use your own referral code' });
        }

        const registrantResult = await db.pool.query(
            'SELECT minted, claim_amount FROM registrants WHERE address = $1',
            [normalizedAddress]
        );

        const hasClaimed = registrantResult.rows[0]?.minted === true;
        const claimAmount = parseFloat(registrantResult.rows[0]?.claim_amount) || 2;

        let immediateBonus = 0;
        let bonusTxHash = null;

        // Update registrant with referrer
        await db.pool.query(`
            UPDATE registrants 
            SET referrer_wallet = $1, referrer_code = $2, referrer_set_at = NOW()
            WHERE address = $3
        `, [referrerWallet, code, normalizedAddress]);

        await db.pool.query(`
            UPDATE referral_codes 
            SET total_referrals = total_referrals + 1, updated_at = NOW()
            WHERE code = $1
        `, [code]);

        await db.pool.query(`
            INSERT INTO referrals (referrer_wallet, referrer_code, referred_wallet, signup_bonus_paid, presale_bonus_paid, created_at)
            VALUES ($1, $2, $3, 0, 0, NOW())
            ON CONFLICT (referred_wallet) DO NOTHING
        `, [referrerWallet, code, normalizedAddress]);

        // Mint bonus if user already claimed
        if (hasClaimed && claimAmount > 0) {
            console.log(' User has already claimed, calculating bonus...');
            
            await minter.initialize();
            
            if (settings.bonus_type === 'fixed') {
                immediateBonus = parseFloat(settings.bonus_amount) || 0;
            } else if (settings.bonus_type === 'percentage') {
                immediateBonus = (claimAmount * parseFloat(settings.bonus_amount)) / 100;
            }
            
            if (immediateBonus > 0) {
                try {
                    console.log(` Minting ${immediateBonus} VIP to referrer ${referrerWallet}...`);
                    
                    const bonusResult = await minter.mintToAddress(referrerWallet, immediateBonus, true);
                    bonusTxHash = bonusResult.receipt?.hash || bonusResult.hash || bonusResult.transactionHash;
                    
                    console.log(' Bonus minted! TX:', bonusTxHash);
                    
                    await db.pool.query(`
                        UPDATE referrals 
                        SET signup_bonus_paid = $1
                        WHERE referred_wallet = $2
                    `, [immediateBonus, normalizedAddress]);
                    
                    await db.pool.query(`
                        UPDATE referral_codes 
                        SET total_bonus_earned = total_bonus_earned + $1,
                            total_claims = total_claims + 1,
                            updated_at = NOW()
                        WHERE code = $2
                    `, [immediateBonus, code]);
                    
                } catch (mintError) {
                    console.error(' Failed to mint immediate bonus:', mintError.message);
                }
            }
        }

        const response = {
            success: true,
            message: 'Referrer linked successfully!',
            referrerWallet: `${referrerWallet.slice(0, 6)}...${referrerWallet.slice(-4)}`
        };
        
        if (immediateBonus > 0 && bonusTxHash) {
            response.bonusPaid = {
                amount: immediateBonus,
                txHash: bonusTxHash,
                reason: 'Bonus for previous claim'
            };
            response.message = `Referrer linked! They received ${immediateBonus.toFixed(4)} VIP bonus.`;
        }

        return res.json(response);

    } catch (error) {
        console.error(' SET REFERRER ERROR:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to set referrer' });
    }
});

// Generate referral code for user
app.post('/api/referral/generate', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        
        console.log('\n GENERATE REFERRAL CODE:', { walletAddress });

        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        const normalizedAddress = walletAddress.toLowerCase();

        const settingsResult = await db.pool.query(
            'SELECT enabled FROM referral_settings WHERE id = 1'
        );
        
        if (!settingsResult.rows[0]?.enabled) {
            return res.status(400).json({ success: false, error: 'Referral program is currently disabled' });
        }

        const existingCode = await db.pool.query(
            'SELECT code, enabled FROM referral_codes WHERE owner_wallet = $1',
            [normalizedAddress]
        );

        if (existingCode.rows.length > 0) {
            return res.json({
                success: true,
                code: existingCode.rows[0].code,
                enabled: existingCode.rows[0].enabled,
                message: 'Referral code already exists'
            });
        }

        let newCode;
        let attempts = 0;

        while (attempts < 10) {
            newCode = generateReferralCode();
            const duplicate = await db.pool.query(
                'SELECT id FROM referral_codes WHERE code = $1',
                [newCode]
            );
            if (duplicate.rows.length === 0) break;
            attempts++;
        }

        if (attempts >= 10) {
            return res.status(500).json({ success: false, error: 'Failed to generate unique code' });
        }

        await db.pool.query(`
            INSERT INTO referral_codes 
            (owner_wallet, code, enabled, total_referrals, total_claims, total_presale_purchases, total_bonus_earned, created_at, updated_at) 
            VALUES ($1, $2, true, 0, 0, 0, 0, NOW(), NOW())
        `, [normalizedAddress, newCode]);

        console.log(' Code generated:', newCode);

        return res.json({
            success: true,
            code: newCode,
            enabled: true,
            message: 'Referral code generated successfully'
        });

    } catch (error) {
        console.error(' GENERATE CODE ERROR:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to generate referral code' });
    }
});

// ===========================================
// Admin Referral Endpoints
// ===========================================
app.get('/api/admin/referral/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM referral_codes) as total_codes,
                (SELECT COUNT(*) FROM referral_codes WHERE enabled = true) as active_codes,
                (SELECT COALESCE(SUM(total_referrals), 0) FROM referral_codes) as total_referrals,
                (SELECT COALESCE(SUM(total_bonus_earned), 0) FROM referral_codes) as total_bonus_earned,
                (SELECT COALESCE(SUM(signup_bonus_paid), 0) FROM referrals) as total_signup_bonus,
                (SELECT COALESCE(SUM(presale_bonus_paid), 0) FROM referrals) as total_presale_bonus
        `);
        
        res.json(stats.rows[0]);
    } catch (error) {
        console.error(' Admin referral stats error:', error.message);
        res.status(500).json({});
    }
});

app.get('/api/admin/referral/codes', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, code, owner_wallet, owner_email, enabled,
                total_referrals, total_claims, total_presale_purchases,
                total_bonus_earned, created_at, updated_at
            FROM referral_codes
            ORDER BY created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error(' Admin referral codes error:', error.message);
        res.status(500).json([]);
    }
});

app.get('/api/admin/referral/list', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, referrer_wallet, referrer_code, referred_wallet,
                referee_email, signup_bonus_paid, presale_bonus_paid,
                presale_bonus_tx, created_at
            FROM referrals
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error(' Admin referral list error:', error.message);
        res.status(500).json([]);
    }
});

// Alias for dashboard compatibility
app.get('/api/admin/referral/activity', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, referrer_wallet, referrer_code, referred_wallet,
                referee_email, signup_bonus_paid, presale_bonus_paid,
                presale_bonus_tx, created_at
            FROM referrals
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error(' Admin referral activity error:', error.message);
        res.status(500).json([]);
    }
});

app.post('/api/admin/referral/code/:code/toggle', requireAdminAuth, async (req, res) => {
    try {
        const { code } = req.params;
        
        const result = await db.pool.query(`
            UPDATE referral_codes 
            SET enabled = NOT enabled, updated_at = NOW()
            WHERE code = $1
            RETURNING code, enabled
        `, [code]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Code not found' });
        }
        
        console.log(` Referral code ${code} toggled to:`, result.rows[0].enabled);
        res.json({ success: true, code: result.rows[0].code, enabled: result.rows[0].enabled });
    } catch (error) {
        console.error(' Toggle referral code error:', error.message);
        res.status(500).json({ error: 'Failed to toggle code' });
    }
});

app.post('/api/admin/referral/create-code', requireAdminAuth, async (req, res) => {
    try {
        const { walletAddress, email } = req.body;
        
        if (!walletAddress || !ethers.isAddress(walletAddress)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        
        const normalizedAddress = walletAddress.toLowerCase();
        
        // Check existing
        const existing = await db.pool.query(
            'SELECT code FROM referral_codes WHERE owner_wallet = $1',
            [normalizedAddress]
        );
        
        if (existing.rows.length > 0) {
            return res.json({ success: true, code: existing.rows[0].code, existing: true });
        }
        
        let newCode;
        let attempts = 0;
        while (attempts < 10) {
            newCode = generateReferralCode();
            const dup = await db.pool.query('SELECT id FROM referral_codes WHERE code = $1', [newCode]);
            if (dup.rows.length === 0) break;
            attempts++;
        }
        
        await db.pool.query(`
            INSERT INTO referral_codes 
            (owner_wallet, owner_email, code, enabled, total_referrals, total_claims, total_presale_purchases, total_bonus_earned, created_at, updated_at)
            VALUES ($1, $2, $3, true, 0, 0, 0, 0, NOW(), NOW())
        `, [normalizedAddress, email || null, newCode]);
        
        res.json({ success: true, code: newCode, existing: false });
    } catch (error) {
        console.error(' Create referral code error:', error.message);
        res.status(500).json({ error: 'Failed to create code' });
    }
});

app.get('/api/presale/packages', async (req, res) => {
  try {
    // Get package sales count from database
    const holidayResult = await db.pool.query(
      "SELECT COUNT(*) as count FROM presale_purchases WHERE purchase_type = 'package_holiday' AND status = 'completed'"
    );
    const membershipResult = await db.pool.query(
      "SELECT COUNT(*) as count FROM presale_purchases WHERE purchase_type = 'package_membership' AND status = 'completed'"
    );
    
    const holidaySold = parseInt(holidayResult.rows[0]?.count || 0);
    const membershipSold = parseInt(membershipResult.rows[0]?.count || 0);
    
    res.json({
      holiday: {
        name: '2026 Holiday Pack',
        price: 5000,
        tokens: 10000,
        totalAvailable: 30,
        sold: holidaySold,
        remaining: Math.max(0, 30 - holidaySold)
      },
      membership: {
        name: 'Private Members Club',
        price: 25000,
        tokens: 50000,
        totalAvailable: null, // unlimited
        sold: membershipSold,
        remaining: null
      }
    });
  } catch (error) {
    console.error('Package config error:', error);
    res.json({
      holiday: { totalAvailable: 30, sold: 0, remaining: 30 },
      membership: { totalAvailable: null, sold: 0, remaining: null }
    });
  }
});

// ===========================================
// Members API (WalletTwo Proxy)
// ===========================================
app.get('/api/members/sync', requireAdminAuth, async (req, res) => {
  try {
    if (!process.env.WALLETTWO_API_KEY || !process.env.WALLETTWO_COMPANY_ID) {
      return res.status(503).json({ error: 'WalletTwo not configured' });
    }

    const baseUrl = `https://api.wallettwo.com/company/admin/company/${process.env.WALLETTWO_COMPANY_ID}/members`;
    const headers = {
      'Authorization': `Bearer ${process.env.WALLETTWO_API_KEY}`,
      'Content-Type': 'application/json'
    };

    let allMembers = [];
    let currentPage = 1;
    let totalPages = 1;

    // Fetch first page to get totalPages
    console.log(`Fetching WalletTwo members page ${currentPage}...`);
    const firstResponse = await fetch(`${baseUrl}?page=${currentPage}`, { headers });
    
    if (!firstResponse.ok) {
      throw new Error(`WalletTwo API error: ${firstResponse.status}`);
    }

    const firstData = await firstResponse.json();
    totalPages = firstData.totalPages || firstData.total_pages || 1;
    const firstPageMembers = firstData.members || firstData.data || firstData.users || [];
    allMembers = allMembers.concat(firstPageMembers);
    
    console.log(`Total pages: ${totalPages}, First page members: ${firstPageMembers.length}`);

    // Fetch remaining pages
    for (currentPage = 2; currentPage <= totalPages; currentPage++) {
      console.log(`Fetching WalletTwo members page ${currentPage}/${totalPages}...`);
      
      const response = await fetch(`${baseUrl}?page=${currentPage}`, { headers });
      
      if (!response.ok) {
        console.error(`Failed to fetch page ${currentPage}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const pageMembers = data.members || data.data || data.users || [];
      allMembers = allMembers.concat(pageMembers);
      
      console.log(`Page ${currentPage}: ${pageMembers.length} members`);
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`Total members fetched: ${allMembers.length}`);

    let synced = 0, updated = 0, errors = 0;

    for (const member of allMembers) {
      const walletAddress = member.wallet_address || member.walletAddress || member.wallet;
      if (!walletAddress) continue;

      try {
        const normalizedWallet = walletAddress.toLowerCase();
        const existing = await db.pool.query(
          'SELECT id FROM registrants WHERE wallet_address = $1',
          [normalizedWallet]
        );

        const email = member.email || null;
        const name = member.name || member.fullName || member.full_name || null;

        if (existing.rows.length > 0) {
          await db.pool.query(
            `UPDATE registrants 
             SET email = COALESCE($1, email), 
                 name = COALESCE($2, name), 
                 source = $3, 
                 updated_at = NOW() 
             WHERE wallet_address = $4`,
            [email, name, 'wallettwo_sync', normalizedWallet]
          );
          updated++;
        } else {
          await db.pool.query(
            `INSERT INTO registrants (wallet_address, email, name, source, created_at) 
             VALUES ($1, $2, $3, $4, NOW())`,
            [normalizedWallet, email, name, 'wallettwo_sync']
          );
          synced++;
        }
      } catch (e) {
        console.error('Sync error for member:', walletAddress, e.message);
        errors++;
      }
    }

    res.json({
      success: true,
      totalPages,
      totalFetched: allMembers.length,
      synced,
      updated,
      errors
    });

  } catch (error) {
    console.error('Members sync error:', error);
    res.status(500).json({ error: 'Failed to sync members: ' + error.message });
  }
});

// ===========================================
// Claim Settings Endpoints
// ===========================================
app.get('/api/admin/claim/settings', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(
            "SELECT value FROM app_settings WHERE key = 'mint_amount'"
        );
        
        const mintAmount = result.rows.length > 0 
            ? parseInt(result.rows[0].value)
            : parseInt(process.env.MINT_AMOUNT) || 2;
        
        res.json({ mintAmount });
    } catch (error) {
        res.json({ mintAmount: parseInt(process.env.MINT_AMOUNT) || 2 });
    }
});

app.post('/api/admin/claim/settings', requireAdminAuth, async (req, res) => {
    try {
        const { mintAmount } = req.body;
        
        if (!mintAmount || mintAmount < 1 || mintAmount > 100) {
            return res.status(400).json({ success: false, error: 'Invalid mint amount (1-100)' });
        }
        
        await db.pool.query(`
            INSERT INTO app_settings (key, value, updated_at) 
            VALUES ('mint_amount', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [mintAmount.toString()]);
        
        res.json({ success: true, mintAmount });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to save settings' });
    }
});

// ===========================================
// Admin Presale Endpoints
// ===========================================
app.post('/api/admin/presale/settings', requireAdminAuth, async (req, res) => {
    try {
        const { saleTargetEUR, tokenPrice, minPurchase, presaleWallet, presaleEnabled } = req.body;
        
        PRESALE_CONFIG.saleTargetEUR = saleTargetEUR || 500000;
        PRESALE_CONFIG.tokenPrice = tokenPrice || 1.00;
        PRESALE_CONFIG.minPurchase = minPurchase || 10;
        PRESALE_CONFIG.presaleWallet = presaleWallet || PRESALE_CONFIG.presaleWallet;
        PRESALE_CONFIG.presaleEnabled = presaleEnabled !== false;
        
        await db.pool.query(`
            INSERT INTO presale_config (id, sale_target_eur, token_price, min_purchase, presale_wallet, presale_enabled, updated_at)
            VALUES (1, $1, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
                sale_target_eur = $1, token_price = $2, min_purchase = $3,
                presale_wallet = $4, presale_enabled = $5, updated_at = NOW()
        `, [saleTargetEUR, tokenPrice, minPurchase, presaleWallet, presaleEnabled]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/presale/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status IN ('completed', 'minted', 'paid', 'pending_mint')) as total_purchases,
                COALESCE(SUM(token_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as tokens_sold,
                COALESCE(SUM(net_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as eur_raised,
                COALESCE(SUM(eur_amount) FILTER (WHERE status IN ('completed', 'minted')), 0) as eur_gross,
                COALESCE(SUM(platform_fee) FILTER (WHERE status IN ('completed', 'minted')), 0) as total_fees,
                COUNT(DISTINCT wallet_address) FILTER (WHERE status IN ('completed', 'minted', 'paid', 'pending_mint')) as unique_buyers,
                COUNT(*) FILTER (WHERE status = 'pending_mint') as pending_mint,
                COUNT(*) FILTER (WHERE status = 'paid') as paid,
                COUNT(*) FILTER (WHERE status IN ('completed', 'minted')) as minted
            FROM presale_purchases
        `);
        
        const row = stats.rows[0];
        const eurRaised = parseFloat(row.eur_raised) || 0;
        const saleTargetEUR = PRESALE_CONFIG.saleTargetEUR || 500000;
        
        res.json({
            eurRaised,
            eurGross: parseFloat(row.eur_gross) || 0,
            totalFees: parseFloat(row.total_fees) || 0,
            saleTargetEUR,
            progressPct: parseFloat(((eurRaised / saleTargetEUR) * 100).toFixed(2)),
            tokensSold: parseFloat(row.tokens_sold) || 0,
            totalTokens: PRESALE_CONFIG.totalTokens || 1000000,
            tokenPriceEUR: PRESALE_CONFIG.tokenPrice || 1.00,
            totalPurchases: parseInt(row.total_purchases) || 0,
            uniqueBuyers: parseInt(row.unique_buyers) || 0,
            pendingMint: parseInt(row.pending_mint) || 0,
            paid: parseInt(row.paid) || 0,
            minted: parseInt(row.minted) || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/presale/purchases', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT 
                id, wallet_address, token_amount, eur_amount, usd_amount,
                platform_fee, net_amount, payment_method, stripe_payment_intent,
                payment_tx_hash, status, mint_tx_hash, referrer_bonus,
                referral_bonus_amount, referral_bonus_paid, error_message,
                created_at, minted_at
            FROM presale_purchases
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json({ purchases: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Bonus Tiers Endpoints (SINGLE DEFINITION)
// ===========================================
app.get('/api/admin/presale/bonus-tiers', requireAdminAuth, async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT id, min_eur, bonus_percent, is_active
            FROM presale_bonus_tiers
            ORDER BY min_eur ASC
        `);
        
        res.json({ tiers: result.rows });
    } catch (error) {
        console.error(' Failed to fetch bonus tiers:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/presale/bonus-tiers', requireAdminAuth, async (req, res) => {
    const { tiers } = req.body;
    
    if (!Array.isArray(tiers)) {
        return res.status(400).json({ error: 'Tiers must be an array' });
    }
    
    console.log(' Saving bonus tiers:', tiers);
    
    try {
        await db.pool.query('BEGIN');
        
        await db.pool.query('UPDATE presale_bonus_tiers SET is_active = false');
        
        for (const tier of tiers) {
            const minEur = parseFloat(tier.min_eur) || 0;
            const bonusPercent = parseFloat(tier.bonus_percent) || 0;
            
            if (minEur > 0 && bonusPercent > 0) {
                const existing = await db.pool.query(
                    'SELECT id FROM presale_bonus_tiers WHERE min_eur = $1',
                    [minEur]
                );
                
                if (existing.rows.length > 0) {
                    await db.pool.query(`
                        UPDATE presale_bonus_tiers 
                        SET bonus_percent = $1, is_active = true, updated_at = NOW()
                        WHERE min_eur = $2
                    `, [bonusPercent, minEur]);
                } else {
                    await db.pool.query(`
                        INSERT INTO presale_bonus_tiers (min_eur, bonus_percent, is_active, created_at, updated_at)
                        VALUES ($1, $2, true, NOW(), NOW())
                    `, [minEur, bonusPercent]);
                }
            }
        }
        
        await db.pool.query('DELETE FROM presale_bonus_tiers WHERE is_active = false');
        await db.pool.query('COMMIT');
        
        console.log(' Bonus tiers saved successfully');
        res.json({ success: true });
        
    } catch (error) {
        await db.pool.query('ROLLBACK');
        console.error(' Failed to save bonus tiers:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/presale/bonus-tiers', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT min_eur, bonus_percent
            FROM presale_bonus_tiers
            WHERE is_active = true
            ORDER BY min_eur ASC
        `);
        
        res.json({ tiers: result.rows });
    } catch (error) {
        console.error(' Failed to fetch bonus tiers:', error);
        res.json({ tiers: [] });
    }
});

// ============================================
// QUESTIONNAIRE ENDPOINTS
// ============================================

// Check registration status
app.get('/api/questionnaire/status/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();

        // Check registrant
        const userResult = await db.pool.query(
            'SELECT registration_complete, minted FROM registrants WHERE wallet_address = $1',
            [wallet]
        );

        if (userResult.rows.length === 0) {
            return res.json({
                success: true,
                exists: false,
                registration_complete: false,
                has_questionnaire: false,
                already_minted: false
            });
        }

        // Check questionnaire
        const questionnaireResult = await db.pool.query(
            'SELECT id FROM questionnaire_responses WHERE wallet_address = $1',
            [wallet]
        );

        res.json({
            success: true,
            exists: true,
            registration_complete: userResult.rows[0].registration_complete || false,
            has_questionnaire: questionnaireResult.rows.length > 0,
            already_minted: userResult.rows[0].minted || false
        });

    } catch (error) {
        console.error('Questionnaire status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit questionnaire
app.post('/api/questionnaire/submit', async (req, res) => {
    try {
        const {
            wallet_address,
            is_property_owner,
            property_location,
            interested_property_index,
            interested_property_tour,
            interested_members_club,
            owns_boat,
            interested_yacht_club,
            interested_restaurant_review
        } = req.body;

        console.log('Questionnaire submit for wallet:', wallet_address);

        if (!wallet_address) {
            return res.status(400).json({ success: false, error: 'Wallet address required' });
        }

        const walletLower = wallet_address.toLowerCase();

        // Check if registrant exists
        const userCheck = await db.pool.query(
            'SELECT id, minted FROM registrants WHERE wallet_address = $1',
            [walletLower]
        );

        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found. Please register first.' });
        }

        const alreadyMinted = userCheck.rows[0].minted;

        // Insert or update questionnaire responses
        await db.pool.query(`
            INSERT INTO questionnaire_responses (
                wallet_address,
                is_property_owner,
                property_location,
                interested_property_index,
                interested_property_tour,
                interested_members_club,
                owns_boat,
                interested_yacht_club,
                interested_restaurant_review,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            ON CONFLICT (wallet_address) 
            DO UPDATE SET
                is_property_owner = $2,
                property_location = $3,
                interested_property_index = $4,
                interested_property_tour = $5,
                interested_members_club = $6,
                owns_boat = $7,
                interested_yacht_club = $8,
                interested_restaurant_review = $9,
                updated_at = NOW()
        `, [
            walletLower,
            is_property_owner || false,
            property_location || '',
            interested_property_index || false,
            interested_property_tour || false,
            interested_members_club || false,
            owns_boat || false,
            interested_yacht_club || false,
            interested_restaurant_review || false
        ]);

        // Mark registration as complete
        await db.pool.query(
            'UPDATE registrants SET registration_complete = TRUE, updated_at = NOW() WHERE wallet_address = $1',
            [walletLower]
        );

        console.log('Questionnaire saved for wallet:', walletLower);

        res.json({ 
            success: true, 
            message: 'Questionnaire submitted successfully',
            already_minted: alreadyMinted
        });

    } catch (error) {
        console.error('Questionnaire submit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get questionnaire data
app.get('/api/questionnaire/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const result = await pool.query(
            'SELECT * FROM questionnaire_responses WHERE wallet_address = $1',
            [wallet.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, exists: false });
        }

        res.json({ success: true, exists: true, data: result.rows[0] });

    } catch (error) {
        console.error('Error fetching questionnaire:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch' });
    }
});

// Create user endpoint (uses registrants)
app.post('/api/users/create', async (req, res) => {
    try {
        const { wallet_address } = req.body;
        
        if (!wallet_address) {
            return res.status(400).json({ success: false, error: 'Wallet address required' });
        }

        // Check if already exists in registrants
        const exists = await pool.query(
            'SELECT id FROM registrants WHERE wallet_address = $1',
            [wallet_address.toLowerCase()]
        );

        if (exists.rows.length > 0) {
            return res.json({ success: true, message: 'User already exists' });
        }

        // User will be created by the normal claim flow
        // This endpoint just checks existence
        res.json({ success: true, message: 'Ready for registration' });

    } catch (error) {
        console.error('Error checking user:', error);
        res.status(500).json({ success: false, error: 'Failed to check user' });
    }
});

// ===========================================
// Presale Payment Verification & Auto-Mint
// ===========================================
async function verifyTransaction(txHash, expectedFrom, expectedUSD, paymentMethod) {
    try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (!tx || !receipt) {
            return { success: false, error: 'Transaction not found' };
        }
        
        if (receipt.status !== 1) {
            return { success: false, error: 'Transaction failed on-chain' };
        }
        
        if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
            return { success: false, error: 'Transaction sender mismatch' };
        }
        
        const presaleWallet = (PRESALE_CONFIG.presaleWallet || process.env.PRESALE_WALLET || '').toLowerCase();
        
        if (!presaleWallet) {
            return { success: true };
        }
        
        if (paymentMethod === 'POL') {
            if (tx.to && tx.to.toLowerCase() !== presaleWallet) {
                return { success: false, error: 'Payment not sent to presale wallet' };
            }
        } else if (paymentMethod === 'USDC') {
            const erc20Interface = new ethers.Interface(ERC20_ABI);
            let foundTransfer = false;
            
            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
                    try {
                        const parsed = erc20Interface.parseLog({ topics: log.topics, data: log.data });
                        if (parsed && parsed.name === 'Transfer') {
                            const to = parsed.args[1].toLowerCase();
                            if (to === presaleWallet) {
                                foundTransfer = true;
                                break;
                            }
                        }
                    } catch (e) {}
                }
            }
            
            if (!foundTransfer) {
                return { success: false, error: 'USDC transfer to presale wallet not found' };
            }
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Verification failed: ' + error.message };
    }
}

app.post('/api/presale/verify-payment', async (req, res) => {
    const { txHash, walletAddress, tokenAmount, totalEUR, totalUSD, paymentMethod, referrerCode, purchaseType } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log(' PRESALE PAYMENT VERIFICATION');
    console.log('='.repeat(60));
    
    if (!txHash || !walletAddress || !tokenAmount) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    if (!ethers.isAddress(walletAddress)) {
        return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    const normalizedAddress = ethers.getAddress(walletAddress).toLowerCase();
    const networkConfig = getNetworkConfig();
    
    const cryptoFeePercent = 0.015;
    const eurAmountTotal = parseFloat(totalEUR) || 0;
    const netAmountEUR = eurAmountTotal / (1 + cryptoFeePercent);
    const platformFeeEUR = eurAmountTotal - netAmountEUR;
    const usdAmountTotal = parseFloat(totalUSD) || 0;
    
    try {
        // Check duplicate
        const existing = await db.pool.query(
            'SELECT id, status, mint_tx_hash FROM presale_purchases WHERE payment_tx_hash = $1',
            [txHash]
        );
        
        if (existing.rows.length > 0) {
            const ep = existing.rows[0];
            if (ep.status === 'completed' && ep.mint_tx_hash) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Transaction already processed',
                    mintTxHash: ep.mint_tx_hash
                });
            }
            return res.status(400).json({ success: false, error: 'Transaction already processed' });
        }
        
        // Verify on-chain
        const txVerified = await verifyTransaction(txHash, normalizedAddress, totalUSD, paymentMethod);
        
        if (!txVerified.success) {
            return res.status(400).json({ success: false, error: txVerified.error });
        }
        
        // Get referrer
        let referrerWallet = null;
        let usedReferrerCode = null;
        let isDefaultReferrer = false;
        
        try {
            const reg = await db.pool.query(
                'SELECT referrer_wallet, referrer_code FROM registrants WHERE address = $1',
                [normalizedAddress]
            );
            if (reg.rows.length > 0 && reg.rows[0].referrer_wallet) {
                referrerWallet = reg.rows[0].referrer_wallet.toLowerCase();
                usedReferrerCode = reg.rows[0].referrer_code;
            }
        } catch (e) {}
        
        if (!referrerWallet && referrerCode && referrerCode !== 'DEFAULT') {
            try {
                const code = await db.pool.query(
                    'SELECT owner_wallet FROM referral_codes WHERE code = $1 AND enabled = true',
                    [referrerCode.toUpperCase()]
                );
                if (code.rows.length > 0) {
                    referrerWallet = code.rows[0].owner_wallet.toLowerCase();
                    usedReferrerCode = referrerCode.toUpperCase();
                }
            } catch (e) {}
        }
        
        if (!referrerWallet) {
            referrerWallet = DEFAULT_REFERRER_WALLET;
            usedReferrerCode = 'DEFAULT';
            isDefaultReferrer = true;
        }
        
        // Calculate bonus
        const bonusInfo = await calculateTokenBonus(netAmountEUR);
        const baseTokens = parseFloat(tokenAmount);
        let bonusTokens = 0;
        
        if (bonusInfo.bonusPercent > 0) {
            bonusTokens = Math.floor(baseTokens * bonusInfo.bonusPercent / 100);
        }
        
        const totalTokensToMint = baseTokens + bonusTokens;
        
        // Record purchase
        const purchaseResult = await db.pool.query(`
            INSERT INTO presale_purchases 
            (wallet_address, token_amount, eur_amount, usd_amount, payment_method, payment_tx_hash, 
            referrer_bonus, platform_fee, net_amount, purchase_bonus_percent, purchase_bonus_tokens, purchase_type, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'paid', NOW())
            RETURNING id
        `, [normalizedAddress, baseTokens, eurAmountTotal, usdAmountTotal, paymentMethod, txHash,
            referrerWallet, platformFeeEUR, netAmountEUR, bonusInfo.bonusPercent, bonusTokens, purchaseType || 'token_sale']);
        
        const purchaseId = purchaseResult.rows[0].id;
        
        // Mint tokens
        await minter.initialize();
        
        let mintResult;
        try {
            mintResult = await minter.mintToAddress(normalizedAddress, totalTokensToMint, true);
        } catch (mintError) {
            mintResult = { error: mintError.message };
        }
        
        if (mintResult && (mintResult.success || mintResult.receipt || mintResult.hash || mintResult.txHash)) {
            const mintTxHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash;
            
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', mint_tx_hash = $1, purchase_bonus_tx = $1, minted_at = NOW()
                WHERE id = $2
            `, [mintTxHash, purchaseId]);
            
            // Update presale stats
            try {
                await db.pool.query(`
                    UPDATE presale_config 
                    SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                        eur_raised = COALESCE(eur_raised, 0) + $2,
                        updated_at = NOW() 
                    WHERE id = 1
                `, [totalTokensToMint, netAmountEUR]);
            } catch (e) {}
            
            // Process referral bonus
            let referralBonus = null;
            
            if (referrerWallet && referrerWallet !== normalizedAddress) {
                try {
                    const settings = await db.pool.query('SELECT * FROM referral_settings WHERE id = 1');
                    
                    if (settings.rows.length > 0 && settings.rows[0].enabled) {
                        const s = settings.rows[0];
                        const minPurchase = parseFloat(s.min_purchase_for_bonus) || 0;
                        
                        if (usdAmountTotal >= minPurchase) {
                            let refBonus = 0;
                            
                            if (s.presale_bonus_type === 'fixed') {
                                refBonus = parseFloat(s.presale_bonus_amount) || 0;
                            } else if (s.presale_bonus_type === 'percentage') {
                                refBonus = (baseTokens * parseFloat(s.presale_bonus_amount)) / 100;
                            }
                            
                            if (refBonus > 0) {
                                const bonusMint = await minter.mintToAddress(referrerWallet, refBonus, true);
                                const bonusTx = bonusMint.txHash || bonusMint.receipt?.hash || bonusMint.hash;
                                
                                if (bonusTx) {
                                    await db.pool.query(`
                                        UPDATE presale_purchases 
                                        SET referral_bonus_amount = $1, referral_bonus_paid = true
                                        WHERE id = $2
                                    `, [refBonus, purchaseId]);
                                    
                                    if (!isDefaultReferrer && usedReferrerCode) {
                                        await db.pool.query(`
                                            UPDATE referral_codes 
                                            SET total_presale_purchases = COALESCE(total_presale_purchases, 0) + 1,
                                                total_bonus_earned = COALESCE(total_bonus_earned, 0) + $1,
                                                updated_at = NOW()
                                            WHERE code = $2
                                        `, [refBonus, usedReferrerCode]);
                                    }
                                    
                                    referralBonus = { 
                                        referrer: referrerWallet, 
                                        amount: refBonus, 
                                        txHash: bonusTx
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
            
            const response = {
                success: true,
                message: `Successfully purchased ${totalTokensToMint} VIP tokens!`,
                purchaseId,
                baseTokens,
                bonusTokens,
                bonusPercent: bonusInfo.bonusPercent,
                totalTokens: totalTokensToMint,
                eurAmount: eurAmountTotal,
                mintTxHash,
                paymentTxHash: txHash,
                explorer_url: `${networkConfig.explorer}/tx/${mintTxHash}`
            };
            
            if (referralBonus) {
                response.referral_bonus = referralBonus;
            }
            
            return res.json(response);
            
        } else {
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'pending_mint', error_message = $1
                WHERE id = $2
            `, [mintResult?.error || 'Minting failed', purchaseId]);
            
            return res.status(500).json({
                success: false,
                error: 'Token minting failed',
                message: 'Payment received. Tokens will be sent within 24 hours.',
                purchaseId,
                status: 'pending_mint'
            });
        }
        
    } catch (error) {
        console.error(' VERIFY PAYMENT ERROR:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Get purchases for wallet
app.get('/api/presale/purchases/:address', async (req, res) => {
    try {
        const { address } = req.params;
        
        if (!address || !ethers.isAddress(address)) {
            return res.json({ success: true, purchases: [] });
        }
        
        const result = await db.pool.query(`
            SELECT id, token_amount, eur_amount, usd_amount, payment_method, 
                   payment_tx_hash, mint_tx_hash, status, created_at, minted_at
            FROM presale_purchases 
            WHERE LOWER(wallet_address) = LOWER($1)
            ORDER BY created_at DESC
        `, [address]);
        
        res.json({ success: true, purchases: result.rows });
    } catch (error) {
        res.json({ success: true, purchases: [] });
    }
});

app.post('/api/admin/presale/mint/:purchaseId', requireAdminAuth, async (req, res) => {
    try {
        const { purchaseId } = req.params;
        
        const purchaseResult = await db.pool.query(
            'SELECT * FROM presale_purchases WHERE id = $1',
            [purchaseId]
        );
        
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Purchase not found' });
        }
        
        const purchase = purchaseResult.rows[0];
        
        if (purchase.status === 'completed' || purchase.status === 'minted') {
            return res.status(400).json({ success: false, error: 'Already minted' });
        }
        
        // Calculate total tokens including bonus
        const baseTokens = parseFloat(purchase.token_amount) || 0;
        const bonusTokens = parseFloat(purchase.purchase_bonus_tokens) || 0;
        const totalTokens = baseTokens + bonusTokens;
        
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        
        const mintResult = await minter.mintToAddress(purchase.wallet_address, totalTokens, true);
        
        if (mintResult && (mintResult.success || mintResult.txHash || mintResult.receipt)) {
            const txHash = mintResult.txHash || mintResult.receipt?.hash || mintResult.hash;
            
            await db.pool.query(`
                UPDATE presale_purchases 
                SET status = 'completed', mint_tx_hash = $1, minted_at = NOW()
                WHERE id = $2
            `, [txHash, purchaseId]);
            
            // Update presale config
            try {
                await db.pool.query(`
                    UPDATE presale_config 
                    SET tokens_sold = COALESCE(tokens_sold, 0) + $1,
                        updated_at = NOW() 
                    WHERE id = 1
                `, [totalTokens]);
            } catch (e) {}
            
            return res.json({
                success: true,
                txHash,
                tokenAmount: totalTokens,
                explorer_url: `${networkConfig.explorer}/tx/${txHash}`
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: mintResult?.error || 'Minting failed' 
            });
        }
        
    } catch (error) {
        console.error(' Manual mint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===========================================
// Health Check
// ===========================================
app.get('/api/health', async (req, res) => {
    const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        network: process.env.NETWORK || 'polygon',
        stripe: stripe ? 'configured' : 'not configured',
        presale: {
            enabled: PRESALE_CONFIG.presaleEnabled,
            tokenPrice: PRESALE_CONFIG.tokenPrice + ' EUR',
            presaleWallet: PRESALE_CONFIG.presaleWallet ? 'configured' : 'not set'
        }
    };

    try {
        const dbConnected = await db.testConnection();
        healthData.database = { status: dbConnected ? 'connected' : 'disconnected', type: 'PostgreSQL' };
    } catch (dbError) {
        healthData.database = { status: 'error', error: dbError.message };
    }

    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        healthData.minter = {
            status: 'initialized',
            wallet: minter.wallet.address,
            tokenAddress: networkConfig.tokenAddress,
            network: networkConfig.name
        };
    } catch (error) {
        healthData.minter = { status: 'error', error: error.message };
    }

    res.json(healthData);
});

// ===========================================
// Catch-all
// ===========================================
app.get('*', (req, res) => {
    res.redirect('/');
});

// ===========================================
// Start Server
// ===========================================
async function startServer() {
  try {
    console.log('\n========================================');
    console.log('Ã°Å¸Å¡â‚¬ KEA VALLEY PRESALE SERVER');
    console.log('========================================\n');

    // Initialize database
    console.log('Ã¢Å¡â„¢Ã¯Â¸Â Initializing database connection...');
    await db.initDb();

    // Ensure tables exist - CALLED HERE
    console.log('Ã¢Å¡â„¢Ã¯Â¸Â Ensuring database tables...');
    await ensureDatabaseTables();

    // Seed default data - CALLED HERE
    console.log('Ã¢Å¡â„¢Ã¯Â¸Â Ensuring default data...');
    await ensureDefaultData();

    // Load presale settings into memory
    console.log('Ã°Å¸â€œÂ¦ Loading presale settings...');
    await loadPresaleSettings();

    // Start HTTP server
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`\n Server running on port ${PORT}\n`);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

  } catch (error) {
    console.error('Ã¢ÂÅ’ Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(server, signal) {
  console.log(`\nÃ‚Â  ${signal} received. Shutting down...`);
  server.close(async () => {
    try {
      await db.pool.end();
      console.log('Ã°Å¸Å¡â‚¬ Shutdown complete');
    } catch (e) {
      console.error('Shutdown error:', e);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    try {
        await db.pool.end();
        console.log('Database pool closed');
    } catch (e) {}
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\nSIGINT received, shutting down...');
    try {
        await db.pool.end();
        console.log('Database pool closed');
    } catch (e) {}
    process.exit(0);
});

// Start if run directly
if (require.main === module) {
    startServer().catch(err => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}

module.exports = {
  app,
  db,
  PRESALE_CONFIG,
  VIP_TOKEN_ADDRESS,
  USDC_ADDRESS,
  DEFAULT_REFERRER_WALLET,
  MINTER_ADDRESS,
  calculateTokenBonus,
  getReferralSettings,
  validateAddress,
  startServer
};