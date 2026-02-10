// src/routes/wallettwo.js
// WalletTwo integration routes

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');

const WALLETTWO_API = 'https://api.wallettwo.com';

// POST /api/wallettwo/exchange - Exchange auth code for user info
router.post('/exchange', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ success: false, error: 'Code is required' });
        }
        
        console.log('🔄 Exchanging WalletTwo code...');
        
        // WalletTwo uses GET /auth/consent?code={code} to exchange the code
        const response = await fetch(`${WALLETTWO_API}/auth/consent?code=${encodeURIComponent(code)}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ WalletTwo exchange failed:', response.status, errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: 'Failed to exchange code with WalletTwo' 
            });
        }
        
        const data = await response.json();
        console.log('✅ WalletTwo exchange success, got access_token');
        
        // Now get user info using the access token
        if (data.access_token) {
            const userResponse = await fetch(`${WALLETTWO_API}/auth/userinfo`, {
                headers: {
                    'Authorization': `Bearer ${data.access_token}`
                }
            });
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                console.log('✅ WalletTwo user info:', userData.email);
                
                return res.json({
                    success: true,
                    user: userData,
                    access_token: data.access_token
                });
            }
        }
        
        // Return what we have
        res.json({
            success: true,
            user: data.user || data,
            access_token: data.access_token
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
        
        const response = await fetch(`${WALLETTWO_API}/auth/userinfo`, {
            headers: {
                'Authorization': authHeader
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).json({ success: false, error: 'Failed to get user info' });
        }
        
        const data = await response.json();
        res.json({ success: true, user: data });
        
    } catch (error) {
        console.error('WalletTwo userinfo error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
