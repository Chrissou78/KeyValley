// src/routes/questionnaire.js
// Questionnaire routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const db = require('../db-postgres');

// Check registration status
router.get('/status/:wallet', async (req, res) => {
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
router.post('/submit', async (req, res) => {
    try {
        const {
            wallet_address,
            email,
            is_property_owner,
            property_location,
            interested_property_index,
            interested_property_tour,
            interested_members_club,
            owns_boat,
            interested_yacht_club,
            interested_restaurant_review
        } = req.body;

        console.log('📋 Questionnaire submit for wallet:', wallet_address, 'email:', email);

        if (!wallet_address) {
            return res.status(400).json({ success: false, error: 'Wallet address required' });
        }

        const walletLower = wallet_address.toLowerCase();

        // Check if registrant exists and get their email if not provided
        const userCheck = await db.pool.query(
            'SELECT id, minted, email FROM registrants WHERE wallet_address = $1',
            [walletLower]
        );

        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found. Please register first.' });
        }

        const alreadyMinted = userCheck.rows[0].minted;
        const existingEmail = userCheck.rows[0].email;
        
        // Use provided email, or fall back to registrant's email
        const finalEmail = email || existingEmail || null;

        console.log('📧 Using email:', finalEmail);

        // If email is provided and registrant doesn't have one, update it
        if (email && !existingEmail) {
            console.log('📧 Updating registrant email to:', email);
            await db.pool.query(
                'UPDATE registrants SET email = $1, updated_at = NOW() WHERE wallet_address = $2',
                [email, walletLower]
            );
        }

        // Insert or update questionnaire responses
        await db.pool.query(`
            INSERT INTO questionnaire_responses (
                wallet_address,
                email,
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            ON CONFLICT (wallet_address) 
            DO UPDATE SET
                email = COALESCE(NULLIF($2, ''), questionnaire_responses.email),
                is_property_owner = $3,
                property_location = $4,
                interested_property_index = $5,
                interested_property_tour = $6,
                interested_members_club = $7,
                owns_boat = $8,
                interested_yacht_club = $9,
                interested_restaurant_review = $10,
                updated_at = NOW()
        `, [
            walletLower,
            finalEmail,
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

        console.log('✅ Questionnaire saved for wallet:', walletLower, 'with email:', finalEmail);

        res.json({ 
            success: true, 
            message: 'Questionnaire submitted successfully',
            already_minted: alreadyMinted
        });

    } catch (error) {
        console.error('❌ Questionnaire submit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get questionnaire data (for pre-filling update form)
router.get('/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const result = await db.pool.query(
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

module.exports = router;
