// src/routes/config.js
const express = require('express');
const router = express.Router();

// Public config (only non-sensitive values)
router.get('/public', (req, res) => {
    res.json({
        walletTwoCompanyId: process.env.WALLETTWO_COMPANY_ID,
        stripePublicKey: process.env.STRIPE_PUBLIC_KEY
    });
});

module.exports = router;