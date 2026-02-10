// src/index.js
// Application entry point

require('dotenv').config();

const app = require('./server');
const db = require('./db-postgres');
const { PRESALE_CONFIG } = require('./config/constants');

// Load presale settings from DB
async function loadPresaleSettings() {
    try {
        const result = await db.pool.query('SELECT * FROM presale_config WHERE id = 1');
        if (result.rows.length > 0) {
            const config = result.rows[0];
            PRESALE_CONFIG.saleTargetEUR = parseFloat(config.sale_target_eur) || PRESALE_CONFIG.saleTargetEUR;
            PRESALE_CONFIG.tokenPrice = parseFloat(config.token_price) || PRESALE_CONFIG.tokenPrice;
            PRESALE_CONFIG.minPurchase = parseFloat(config.min_purchase) || PRESALE_CONFIG.minPurchase;
            PRESALE_CONFIG.presaleWallet = config.presale_wallet || PRESALE_CONFIG.presaleWallet;
            PRESALE_CONFIG.presaleEnabled = config.presale_enabled !== false;
            console.log('📦 Presale settings loaded from DB');
        }
    } catch (error) {
        console.log('  Using default presale settings');
    }
}

async function startServer() {
    try {
        console.log('\n========================================');
        console.log('🚀 KEA VALLEY PRESALE SERVER');
        console.log('========================================\n');

        // Initialize database
        console.log('⚙️ Initializing database connection...');
        await db.initDb();

        // Load presale settings
        console.log('📦 Loading presale settings...');
        await loadPresaleSettings();

        // Start HTTP server
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log(`\n✅ Server running on port ${PORT}\n`);
        });

        // Graceful shutdown
        const gracefulShutdown = async (signal) => {
            console.log(`\n  ${signal} received. Shutting down...`);
            server.close(async () => {
                try {
                    await db.pool.end();
                    console.log('🚀 Shutdown complete');
                } catch (e) {
                    console.error('Shutdown error:', e);
                }
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Vercel serverless handler
if (process.env.VERCEL) {
    let initialized = false;
    
    module.exports = async (req, res) => {
        if (!initialized) {
            try {
                await db.initDb();
                await loadPresaleSettings();
                initialized = true;
                console.log('✅ Vercel initialization complete');
            } catch (error) {
                console.error('Vercel init error:', error);
            }
        }
        return app(req, res);
    };
} else {
    // Local development
    if (require.main === module) {
        startServer();
    }
    
    // Export for local testing/imports
    module.exports = { app, startServer };
}
