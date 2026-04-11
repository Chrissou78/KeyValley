// src/routes/config.js
const express = require('express');
const router = express.Router();
const {
  VIP_TOKEN_ADDRESS,
  POLYGON_RPC,
  EXPLORER_URL,
  CHAIN_ID,
  WALLETTWO_ORIGIN,
  WALLETTWO_COMPANY_ID,
  STRIPE_PUBLIC_KEY,
  SESSION_DURATION
} = require('../config/constants');

// Debug log to see what's being loaded
console.log('📋 Config route loaded with POLYGON_RPC:', POLYGON_RPC);

router.get('/public', (req, res) => {
  res.json({
    vipTokenAddress: VIP_TOKEN_ADDRESS,
    polygonRpc: POLYGON_RPC,
    explorerUrl: EXPLORER_URL,
    chainId: CHAIN_ID,
    walletTwoOrigin: WALLETTWO_ORIGIN,
    walletTwoCompanyId: WALLETTWO_COMPANY_ID,
    stripePublicKey: STRIPE_PUBLIC_KEY,
    sessionDuration: SESSION_DURATION
  });
});

module.exports = router;