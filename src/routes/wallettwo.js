// src/routes/wallettwo.js
// WalletTwo integration routes - UPDATED for new SDK

const express = require('express');
const router = express.Router();

const WALLETTWO_API = 'https://api.wallettwo.com';

// POST /api/wallettwo/exchange - Exchange one-time token for session
router.post('/exchange', async (req, res) => {
    try {
        const { code, token } = req.body;
        const tokenToExchange = token || code; // Support both old and new field names
        
        if (!tokenToExchange) {
            return res.status(400).json({ success: false, error: 'Token is required' });
        }
        
        console.log('🔄 Exchanging WalletTwo token...');
        
        // NEW: Use the one-time-token/verify endpoint
        const response = await fetch(`${WALLETTWO_API}/auth/api/auth/one-time-token/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenToExchange })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ WalletTwo exchange failed:', response.status, errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: 'Failed to exchange token with WalletTwo' 
            });
        }
        
        const data = await response.json();
        console.log('✅ WalletTwo exchange success');
        
        // Get user info using the session token
        if (data.session && data.session.token) {
            const userResponse = await fetch(`${WALLETTWO_API}/auth/api/auth/get-session`, {
                headers: {
                    'Authorization': `Bearer ${data.session.token}`
                }
            });
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                console.log('✅ WalletTwo user info:', userData.user?.email);
                
                return res.json({
                    success: true,
                    user: userData.user,
                    session: data.session,
                    access_token: data.session.token
                });
            }
        }
        
        // Return what we have
        res.json({
            success: true,
            session: data.session,
            access_token: data.session?.token
        });
        
    } catch (error) {
        console.error('❌ WalletTwo exchange error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/wallettwo/userinfo - Get user info from token
router.get('/userinfo', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ success: false, error: 'No authorization header' });
        }
        
        // NEW: Use the get-session endpoint
        const response = await fetch(`${WALLETTWO_API}/auth/api/auth/get-session`, {
            headers: {
                'Authorization': authHeader
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).json({ success: false, error: 'Failed to get user info' });
        }
        
        const data = await response.json();
        res.json({ success: true, user: data.user });
        
    } catch (error) {
        console.error('WalletTwo userinfo error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
