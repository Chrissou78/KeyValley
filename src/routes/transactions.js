// src/routes/transactions.js
// Transaction management routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const db = require('../db-postgres');
const minter = require('../minter');
const { requireAdminAuth } = require('../middleware/auth');
const { POLYGON_RPC } = require('../config/constants');

// Helper to validate tx hash
const isValidTxHash = (hash) => {
    return hash && 
           typeof hash === 'string' &&
           hash.startsWith('0x') && 
           hash.length === 66 &&
           !['pre-existing', 'synced-from-chain', 'ALREADY_HAD_TOKENS', 'skipped'].includes(hash);
};

// Check all pending transactions (admin)
router.post('/check-all-transactions', requireAdminAuth, async (req, res) => {
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
        
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC || POLYGON_RPC);
        
        let confirmed = 0;
        let failed = 0;
        let timeout = 0;
        let stillPending = 0;
        let skipped = 0;
        
        for (const row of result.rows) {
            // Skip invalid tx hashes
            if (!isValidTxHash(row.tx_hash)) {
                console.log(`⏭️ Skipping invalid tx_hash: ${row.tx_hash}`);
                skipped++;
                continue;
            }
            
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
                console.error(`RPC error checking tx:`, err.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Transaction check completed',
            results: { confirmed, failed, timeout, stillPending, skipped },
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Admin check transactions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Retry failed/timeout mints (admin)
router.post('/retry-failed-mints', requireAdminAuth, async (req, res) => {
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

// Get all transactions (admin)
router.get('/transactions', requireAdminAuth, async (req, res) => {
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
            WHERE tx_hash IS NOT NULL OR tx_status IS NOT NULL
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

// Retry single mint (admin)
router.post('/retry-single-mint', requireAdminAuth, async (req, res) => {
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

module.exports = router;
