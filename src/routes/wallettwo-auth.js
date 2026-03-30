// src/routes/wallettwo-auth.js
const express = require('express');
const router = express.Router();

const WALLETTWO_API_KEY = process.env.WALLETTWO_API_KEY;
const WALLETTWO_COMPANY_ID = process.env.WALLETTWO_COMPANY_ID;
const BASE_URL = 'https://api.wallettwo.com';

// Exchange authorization code/token for access token and user info
router.post('/exchange', async (req, res) => {
    // Support both old 'code' and new 'token' field names
    const token = req.body.token || req.body.code;
    
    if (!token) {
        return res.status(400).json({ success: false, error: 'Token is required' });
    }

    console.log('🔄 WalletTwo exchange - token:', token.substring(0, 10) + '...');

    try {
        // NEW SDK: Use one-time-token/verify endpoint
        const verifyResponse = await fetch(`${BASE_URL}/auth/api/auth/one-time-token/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        
        const verifyData = await verifyResponse.json();
        console.log('🔑 Verify response:', verifyResponse.status);
        
        if (!verifyResponse.ok || !verifyData.session) {
            console.error('❌ Token verification failed:', verifyData);
            
            // FALLBACK: Try old consent endpoint for backwards compatibility
            console.log('🔄 Trying legacy consent endpoint...');
            const consentUrl = `${BASE_URL}/auth/consent?code=${encodeURIComponent(token)}`;
            const legacyResponse = await fetch(consentUrl);
            const legacyData = await legacyResponse.json();
            
            if (legacyResponse.ok && legacyData.access_token) {
                console.log('✅ Legacy consent worked');
                return await handleLegacyFlow(legacyData.access_token, res);
            }
            
            return res.status(verifyResponse.status).json({ 
                success: false, 
                error: verifyData.error || 'Token verification failed' 
            });
        }

        const accessToken = verifyData.session.token;
        console.log('✅ Got session token');

        // Get user info with the session token
        const userInfoResponse = await fetch(`${BASE_URL}/auth/api/auth/get-session`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const userInfo = await userInfoResponse.json();
        console.log('👤 Session response:', userInfoResponse.status);
        
        if (!userInfoResponse.ok || !userInfo.user) {
            console.error('❌ Get session failed:', userInfo);
            // Still return token even if user info fails
            return res.json({
                success: true,
                access_token: accessToken,
                email: null,
                name: null
            });
        }

        const user = userInfo.user;
        console.log('✅ Got user info - email:', user.email);

        // Return success with all user data
        res.json({
            success: true,
            access_token: accessToken,
            email: user.email,
            name: user.name || `${user.given_name || ''} ${user.family_name || ''}`.trim(),
            firstName: user.given_name,
            lastName: user.family_name,
            email_verified: user.email_verified,
            sub: user.sub,
            wallet: user.wallet,
            user: user
        });

    } catch (error) {
        console.error('❌ Exchange error:', error);
        res.status(500).json({ success: false, error: 'Exchange failed', details: error.message });
    }
});

// Helper for legacy flow
async function handleLegacyFlow(accessToken, res) {
    try {
        const userInfoResponse = await fetch(`${BASE_URL}/auth/userinfo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const userInfo = await userInfoResponse.json();
        
        res.json({
            success: true,
            access_token: accessToken,
            email: userInfo.email,
            name: userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
            firstName: userInfo.given_name,
            lastName: userInfo.family_name,
            email_verified: userInfo.email_verified,
            sub: userInfo.sub,
            user: userInfo
        });
    } catch (error) {
        res.json({
            success: true,
            access_token: accessToken,
            email: null,
            name: null
        });
    }
}

// Get user info from existing token
router.post('/userinfo', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ success: false, error: 'Token is required' });
    }

    try {
        // Try new endpoint first
        let response = await fetch(`${BASE_URL}/auth/api/auth/get-session`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        let data = await response.json();
        
        if (response.ok && data.user) {
            return res.json({
                success: true,
                email: data.user.email,
                name: data.user.name,
                sub: data.user.sub,
                user: data.user
            });
        }
        
        // Fallback to old endpoint
        response = await fetch(`${BASE_URL}/auth/userinfo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        data = await response.json();
        
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
