// src/routes/wallettwo-auth.js
const express = require('express');
const router = express.Router();

const WALLETTWO_API_KEY = process.env.WALLETTWO_API_KEY;
const WALLETTWO_COMPANY_ID = process.env.WALLETTWO_COMPANY_ID;
const BASE_URL = 'https://api.wallettwo.com';

// Exchange authorization code for access token and user info
router.post('/exchange', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ success: false, error: 'Code is required' });
    }

    console.log('🔄 WalletTwo exchange - code:', code.substring(0, 10) + '...');

    try {
        // Step 1: Exchange code for access token
        const consentUrl = `${BASE_URL}/auth/consent?code=${encodeURIComponent(code)}&apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`;
        
        const tokenResponse = await fetch(consentUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const tokenData = await tokenResponse.json();
        console.log('🔑 Consent response:', tokenResponse.status, tokenData.success);
        
        if (!tokenResponse.ok || !tokenData.access_token) {
            console.error('❌ Token exchange failed:', tokenData);
            return res.status(tokenResponse.status).json({ 
                success: false, 
                error: tokenData.error || 'Token exchange failed' 
            });
        }

        const accessToken = tokenData.access_token;
        console.log('✅ Got access token');

        // Step 2: Get user info with the access token
        const userInfoResponse = await fetch(`${BASE_URL}/auth/userinfo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const userInfo = await userInfoResponse.json();
        console.log('👤 UserInfo response:', userInfoResponse.status, userInfo.success);
        
        if (!userInfoResponse.ok || !userInfo.success) {
            console.error('❌ UserInfo failed:', userInfo);
            // Still return token even if userinfo fails
            return res.json({
                success: true,
                access_token: accessToken,
                email: null,
                name: null
            });
        }

        console.log('✅ Got user info - email:', userInfo.email);

        // Return success with all user data
        res.json({
            success: true,
            access_token: accessToken,
            email: userInfo.email,
            name: userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
            email_verified: userInfo.email_verified,
            sub: userInfo.sub,
            user: userInfo
        });

    } catch (error) {
        console.error('❌ Exchange error:', error);
        res.status(500).json({ success: false, error: 'Exchange failed', details: error.message });
    }
});

// Get user info from existing token (if needed separately)
router.post('/userinfo', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ success: false, error: 'Token is required' });
    }

    try {
        const response = await fetch(`${BASE_URL}/auth/userinfo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            success: true,
            email: data.email,
            name: data.name,
            sub: data.sub,
            user: data
        });

    } catch (error) {
        console.error('UserInfo error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user info' });
    }
});

module.exports = router;
