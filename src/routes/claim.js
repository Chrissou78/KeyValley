// src/routes/claim.js
// Public claim routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const db = require('../db-postgres');
const minter = require('../minter');
const { getNetworkConfig } = require('../config/networks');
const { POLYGON_RPC, EXPLORER_URL } = require('../config/constants');

// Helper function to validate address
function validateAddress(address) {
    return address && ethers.isAddress(address);
}

// Register and mint tokens (public claim)
router.post('/register', async (req, res) => {
    try {
        const { wallet_address, signature, message, referral_code } = req.body;
        
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
                    explorer_url: `${EXPLORER_URL}/tx/${row.tx_hash}`
                });
            }
            
            // If pending with tx_hash, don't allow another mint
            if (row.tx_status === 'pending' && row.tx_hash) {
                return res.status(409).json({ 
                    success: false,
                    message: 'A claim is already in progress. Please wait for confirmation.',
                    tx_hash: row.tx_hash,
                    tx_status: 'pending',
                    explorer_url: `${EXPLORER_URL}/tx/${row.tx_hash}`
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
            // Get mint amount from settings
            let mintAmount = 2;
            try {
                const settingsResult = await db.pool.query(
                    "SELECT value FROM app_settings WHERE key = 'mint_amount'"
                );
                if (settingsResult.rows.length > 0) {
                    mintAmount = parseInt(settingsResult.rows[0].value) || 2;
                }
            } catch (e) {
                console.log('Using default mint amount:', mintAmount);
            }

            console.log(`💰 Mint amount: ${mintAmount} VIP`);

            // Skip balance check so users can claim even if they already have tokens
            const mintPromise = minter.mintToAddress(walletLower, mintAmount, true);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), 60000) // 60 second timeout
            );
            
            let txHash = null;
            
            try {
                // Race between mint and timeout
                const mintResult = await Promise.race([mintPromise, timeoutPromise]);
                
                // Extract tx hash from receipt (minter returns { receipt })
                txHash = mintResult.receipt?.hash || mintResult.hash || mintResult.transactionHash;
                
                console.log(`✅ Mint completed, TX: ${txHash}`);
                
                // Update database with confirmed status
                await db.pool.query(`
                    UPDATE registrants 
                    SET minted = true,
                        tx_hash = $2, 
                        tx_status = 'confirmed',
                        minted_at = NOW(),
                        updated_at = NOW()
                    WHERE wallet_address = $1
                `, [walletLower, txHash]);
                
                // Process referral bonus if referral code exists
                await processReferralBonus(walletLower, mintAmount);
                return res.status(201).json({
                    success: true,
                    message: 'Tokens minted successfully!',
                    tx_hash: txHash,
                    tx_status: 'confirmed',
                    explorer_url: `${EXPLORER_URL}/tx/${txHash}`
                });
                
            } catch (timeoutError) {
                if (timeoutError.message === 'TIMEOUT') {
                    console.log('⏱️ Mint timeout, continuing in background...');
                    
                    // Let mint continue in background
                    mintPromise.then(async (result) => {
                        const bgTxHash = result.receipt?.hash || result.hash || result.transactionHash;
                        console.log(`📋 Background mint completed, TX: ${bgTxHash}`);
                        
                        await db.pool.query(`
                            UPDATE registrants 
                            SET minted = true,
                                tx_hash = $2,
                                tx_status = 'confirmed',
                                minted_at = NOW(),
                                updated_at = NOW()
                            WHERE wallet_address = $1
                        `, [walletLower, bgTxHash]);
                        
                        // Process referral bonus
                        await processReferralBonus(walletLower, mintAmount);
                    }).catch(err => {
                        console.error('❌ Background mint failed:', err.message);
                        db.pool.query(`
                            UPDATE registrants 
                            SET tx_status = 'failed',
                                updated_at = NOW()
                            WHERE wallet_address = $1
                        `, [walletLower]);
                    });
                    
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
            console.error('❌ Mint error:', mintError.message);
            
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

// Process referral bonus
async function processReferralBonus(claimerWallet, mintAmount) {
    const OWNER_WALLET = '0xdD4104A780142EfB9566659f26d3317714a81510'.toLowerCase();
    
    try {
        console.log(`🎁 Processing referral bonus for claimer: ${claimerWallet}`);
        
        // Get referral settings
        const settingsResult = await db.pool.query(
            "SELECT * FROM referral_settings WHERE id = 1"
        );
        
        if (settingsResult.rows.length === 0) {
            console.log('No referral settings found');
            return;
        }
        
        const settings = settingsResult.rows[0];
        
        if (!settings.enabled) {
            console.log('Referrals disabled');
            return;
        }
        
        // Get the referrer from the registrant's record
        const registrantResult = await db.pool.query(
            'SELECT referrer_wallet, referrer_code FROM registrants WHERE wallet_address = $1',
            [claimerWallet.toLowerCase()]
        );
        
        if (registrantResult.rows.length === 0) {
            console.log('Registrant not found');
            return;
        }
        
        let referrerWallet = registrantResult.rows[0].referrer_wallet;
        const referrerCode = registrantResult.rows[0].referrer_code;
        const isSilent = !referrerWallet; // No referrer = silent bonus to owner
        
        // Default to owner wallet if no referrer
        if (!referrerWallet) {
            referrerWallet = OWNER_WALLET;
        }
        
        // Don't give bonus if claimer is the owner
        if (claimerWallet.toLowerCase() === OWNER_WALLET) {
            console.log('Owner wallet - no referral bonus');
            return;
        }
        
        // Don't give bonus to self
        if (referrerWallet.toLowerCase() === claimerWallet.toLowerCase()) {
            console.log('Self-referral - no bonus');
            return;
        }
        
        // Calculate bonus amount based on settings
        let bonusAmount = 0;
        if (settings.bonus_type === 'fixed') {
            bonusAmount = parseFloat(settings.bonus_amount) || 2;
        } else if (settings.bonus_type === 'percentage') {
            bonusAmount = Math.floor(mintAmount * (parseFloat(settings.bonus_amount) || 10) / 100);
        }
        
        if (bonusAmount <= 0) {
            console.log('No bonus to mint');
            return;
        }
        
        console.log(`💰 Minting ${bonusAmount} VIP referral bonus to: ${referrerWallet}${isSilent ? ' (silent - owner)' : ''}`);
        
        // Mint the bonus tokens
        try {
            const bonusResult = await minter.mintToAddress(referrerWallet, bonusAmount, true);
            const bonusTxHash = bonusResult.receipt?.hash;
            
            console.log(`✅ Referral bonus minted, TX: ${bonusTxHash}`);
            
            // Only track in DB if not silent (has actual referrer)
            if (!isSilent && referrerCode) {
                // Record the referral tracking
                await db.pool.query(`
                    INSERT INTO referral_tracking 
                    (referral_code, referred_wallet, referrer_wallet, source, bonus_type, bonus_amount, bonus_paid, bonus_tx_hash, created_at)
                    VALUES ($1, $2, $3, 'claim', 'claim', $4, true, $5, NOW())
                `, [referrerCode.toUpperCase(), claimerWallet, referrerWallet, bonusAmount, bonusTxHash]);
                
                // Update referral code stats
                await db.pool.query(`
                    UPDATE referral_codes 
                    SET use_count = use_count + 1,
                        claim_count = claim_count + 1,
                        total_bonus = total_bonus + $1,
                        updated_at = NOW()
                    WHERE code = $2
                `, [bonusAmount, referrerCode.toUpperCase()]);
            }
            
        } catch (bonusError) {
            console.error('❌ Referral bonus mint failed:', bonusError.message);
        }
        
    } catch (error) {
        console.error('Referral bonus error:', error.message);
    }
}

// Check claim status (with blockchain verification)
router.get('/check-status/:wallet', async (req, res) => {
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
                explorer_url: row.tx_hash ? `${EXPLORER_URL}/tx/${row.tx_hash}` : null
            });
        }
        
        // If pending, check the blockchain
        if (row.tx_status === 'pending' && row.tx_hash) {
            try {
                const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC || POLYGON_RPC);
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
                        explorer_url: `${EXPLORER_URL}/tx/${row.tx_hash}`
                    });
                }
                
                // Still pending - check timeout
                const mintedAt = new Date(row.minted_at);
                const minutesElapsed = (Date.now() - mintedAt.getTime()) / 1000 / 60;
                
                if (minutesElapsed > 30) {
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
                        explorer_url: `${EXPLORER_URL}/tx/${row.tx_hash}`
                    });
                }
                
            } catch (rpcError) {
                console.error('RPC error checking tx:', rpcError.message);
            }
        }
        
        return res.json({
            success: true,
            exists: true,
            claimed: row.minted,
            tx_hash: row.tx_hash,
            tx_status: row.tx_status,
            explorer_url: row.tx_hash ? `${EXPLORER_URL}/tx/${row.tx_hash}` : null
        });
        
    } catch (error) {
        console.error('Check status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get claim status (legacy endpoint)
router.get('/status/:address', async (req, res) => {
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

module.exports = router;
