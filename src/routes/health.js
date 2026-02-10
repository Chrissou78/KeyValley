// src/routes/health.js
// Health check endpoint - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');
const minter = require('../minter');
const { getNetworkConfig } = require('../config/networks');
const { PRESALE_CONFIG } = require('../config/constants');

// Initialize Stripe only if secret key exists
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

router.get('/', async (req, res) => {
    const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        network: process.env.NETWORK || 'polygon',
        stripe: !!stripe,
        presale: {
            enabled: PRESALE_CONFIG.presaleEnabled,
            tokenPrice: PRESALE_CONFIG.tokenPrice + ' EUR',
            presaleWallet: PRESALE_CONFIG.presaleWallet ? 'configured' : 'not set'
        }
    };

    // Database check
    try {
        const dbConnected = await db.testConnection();
        healthData.database = dbConnected;
        
        // Get stats if connected
        if (dbConnected) {
            try {
                const registrantsResult = await db.pool.query('SELECT COUNT(*) FROM registrants');
                const purchasesResult = await db.pool.query('SELECT COUNT(*) FROM presale_purchases');
                
                healthData.stats = {
                    registrants: parseInt(registrantsResult.rows[0].count) || 0,
                    purchases: parseInt(purchasesResult.rows[0].count) || 0
                };
            } catch (statsError) {
                console.error('Error fetching stats:', statsError.message);
                healthData.stats = { registrants: 0, purchases: 0 };
            }
        }
    } catch (dbError) {
        healthData.database = false;
        healthData.stats = { registrants: 0, purchases: 0 };
    }

    // Minter check
    try {
        await minter.initialize();
        const networkConfig = getNetworkConfig();
        healthData.minter = true;
        healthData.minterWallet = minter.wallet.address;
        healthData.tokenAddress = networkConfig.tokenAddress;
    } catch (error) {
        healthData.minter = false;
    }

    res.json(healthData);
});

module.exports = router;
