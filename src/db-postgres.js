const { Pool } = require('pg');

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:0bhflyqbczsd9cf0@91.99.21.245:63023/postgres',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Track initialization
let isInitialized = false;

/**
 * Initialize database tables
 */
async function initDb() {
    if (isInitialized) {
        await pool.query(`
            ALTER TABLE registrants 
            ADD COLUMN IF NOT EXISTS email VARCHAR(255)
        `);
        return;
    }

    const client = await pool.connect();
    try {
        // Create registrants table
        await client.query(`
            CREATE TABLE IF NOT EXISTS registrants (
                id SERIAL PRIMARY KEY,
                address VARCHAR(42) UNIQUE NOT NULL,
                minted BOOLEAN DEFAULT FALSE,
                tx_hash VARCHAR(66),
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                minted_at TIMESTAMP,
                signature TEXT,
                metadata JSONB DEFAULT '{}'::jsonb
            )
        `);

        // Create index on address for faster lookups
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_registrants_address ON registrants(address)
        `);

        // Create index on minted status for filtering
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_registrants_minted ON registrants(minted)
        `);

        // Create admin_users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                must_change_password BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        `);

        // Create sessions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(64) UNIQUE NOT NULL,
                username VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        // Create index on session_id
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)
        `);

        // Create presale_purchases table
        await client.query(`
            CREATE TABLE IF NOT EXISTS presale_purchases (
                id SERIAL PRIMARY KEY,
                wallet_address VARCHAR(42) NOT NULL,
                token_amount INTEGER NOT NULL,
                payment_method VARCHAR(20) NOT NULL,
                payment_amount DECIMAL(20, 8) NOT NULL,
                usd_amount DECIMAL(20, 2) NOT NULL,
                status VARCHAR(30) DEFAULT 'pending',
                stripe_session_id VARCHAR(255),
                stripe_payment_intent VARCHAR(255),
                tx_hash VARCHAR(66),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_presale_wallet ON presale_purchases(wallet_address)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_presale_status ON presale_purchases(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_presale_stripe ON presale_purchases(stripe_session_id)`);

        // Clean up expired sessions
        await client.query(`
            DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP
        `);

        isInitialized = true;
        console.log('✅ PostgreSQL database initialized');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Registrant Operations
 */

// Add a new registrant
async function addRegistrant(address, signature = null, metadata = {}) {
    const normalizedAddress = address.toLowerCase();
    try {
        const result = await pool.query(
            `INSERT INTO registrants (address, signature, metadata) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (address) DO NOTHING
             RETURNING *`,
            [normalizedAddress, signature, JSON.stringify(metadata)]
        );
        return result.rows[0] || await getRegistrant(normalizedAddress);
    } catch (error) {
        console.error('Error adding registrant:', error);
        throw error;
    }
}

// Get a single registrant by address
async function getRegistrant(address) {
    const normalizedAddress = address.toLowerCase();
    try {
        const result = await pool.query(
            'SELECT * FROM registrants WHERE address = $1',
            [normalizedAddress]
        );
        if (result.rows[0]) {
            return formatRegistrant(result.rows[0]);
        }
        return null;
    } catch (error) {
        console.error('Error getting registrant:', error);
        throw error;
    }
}

// Get all registrants
async function getAllRegistrants() {
    try {
        const result = await pool.query(
            'SELECT * FROM registrants ORDER BY registered_at DESC'
        );
        return result.rows.map(formatRegistrant);
    } catch (error) {
        console.error('Error getting all registrants:', error);
        throw error;
    }
}

// Get pending (unminted) registrants
async function getPendingRegistrants() {
    try {
        const result = await pool.query(
            'SELECT * FROM registrants WHERE minted = FALSE ORDER BY registered_at ASC'
        );
        return result.rows.map(formatRegistrant);
    } catch (error) {
        console.error('Error getting pending registrants:', error);
        throw error;
    }
}

// Mark registrant as minted
async function markAsMinted(address, txHash = null) {
    const normalizedAddress = address.toLowerCase();
    try {
        const result = await pool.query(
            `UPDATE registrants 
             SET minted = TRUE, tx_hash = $2, minted_at = CURRENT_TIMESTAMP 
             WHERE address = $1
             RETURNING *`,
            [normalizedAddress, txHash]
        );
        return result.rows[0] ? formatRegistrant(result.rows[0]) : null;
    } catch (error) {
        console.error('Error marking as minted:', error);
        throw error;
    }
}

// Update registrant metadata
async function updateRegistrant(address, updates) {
    const normalizedAddress = address.toLowerCase();
    try {
        const setClauses = [];
        const values = [normalizedAddress];
        let paramIndex = 2;

        if (updates.minted !== undefined) {
            setClauses.push(`minted = $${paramIndex++}`);
            values.push(updates.minted);
        }
        if (updates.txHash !== undefined) {
            setClauses.push(`tx_hash = $${paramIndex++}`);
            values.push(updates.txHash);
        }
        if (updates.metadata !== undefined) {
            setClauses.push(`metadata = $${paramIndex++}`);
            values.push(JSON.stringify(updates.metadata));
        }

        if (setClauses.length === 0) return await getRegistrant(normalizedAddress);

        const result = await pool.query(
            `UPDATE registrants SET ${setClauses.join(', ')} WHERE address = $1 RETURNING *`,
            values
        );
        return result.rows[0] ? formatRegistrant(result.rows[0]) : null;
    } catch (error) {
        console.error('Error updating registrant:', error);
        throw error;
    }
}

// Check if address exists
async function hasRegistrant(address) {
    const normalizedAddress = address.toLowerCase();
    try {
        const result = await pool.query(
            'SELECT 1 FROM registrants WHERE address = $1',
            [normalizedAddress]
        );
        return result.rows.length > 0;
    } catch (error) {
        console.error('Error checking registrant:', error);
        throw error;
    }
}

// Get statistics
async function getStats() {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE minted = TRUE) as minted,
                COUNT(*) FILTER (WHERE minted = FALSE) as pending
            FROM registrants
        `);
        const stats = result.rows[0];
        return {
            total: parseInt(stats.total) || 0,
            minted: parseInt(stats.minted) || 0,
            pending: parseInt(stats.pending) || 0
        };
    } catch (error) {
        console.error('Error getting stats:', error);
        return { total: 0, minted: 0, pending: 0 };
    }
}

/**
 * Admin User Operations
 */

// Get admin user by username
async function getAdminUser(username) {
    try {
        const result = await pool.query(
            'SELECT * FROM admin_users WHERE username = $1',
            [username]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting admin user:', error);
        throw error;
    }
}

// Create admin user
async function createAdminUser(username, passwordHash, mustChangePassword = true) {
    try {
        const result = await pool.query(
            `INSERT INTO admin_users (username, password_hash, must_change_password)
             VALUES ($1, $2, $3)
             ON CONFLICT (username) DO UPDATE SET password_hash = $2, must_change_password = $3
             RETURNING *`,
            [username, passwordHash, mustChangePassword]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error creating admin user:', error);
        throw error;
    }
}

// Update admin password
async function updateAdminPassword(username, passwordHash, mustChangePassword = false) {
    try {
        const result = await pool.query(
            `UPDATE admin_users 
             SET password_hash = $2, must_change_password = $3 
             WHERE username = $1
             RETURNING *`,
            [username, passwordHash, mustChangePassword]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error updating admin password:', error);
        throw error;
    }
}

// Update last login
async function updateLastLogin(username) {
    try {
        await pool.query(
            'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE username = $1',
            [username]
        );
    } catch (error) {
        console.error('Error updating last login:', error);
    }
}

/**
 * Session Operations
 */

// Create session
async function createSession(sessionId, username, expiresInHours = 24) {
    try {
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO sessions (session_id, username, expires_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (session_id) DO UPDATE SET username = $2, expires_at = $3`,
            [sessionId, username, expiresAt]
        );
        return { sessionId, username, expiresAt };
    } catch (error) {
        console.error('Error creating session:', error);
        throw error;
    }
}

// Get session
async function getSession(sessionId) {
    try {
        const result = await pool.query(
            `SELECT * FROM sessions 
             WHERE session_id = $1 AND expires_at > CURRENT_TIMESTAMP`,
            [sessionId]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting session:', error);
        return null;
    }
}

// Delete session
async function deleteSession(sessionId) {
    try {
        await pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
    } catch (error) {
        console.error('Error deleting session:', error);
    }
}

// Clean expired sessions
async function cleanExpiredSessions() {
    try {
        const result = await pool.query(
            'DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP'
        );
        return result.rowCount;
    } catch (error) {
        console.error('Error cleaning sessions:', error);
        return 0;
    }
}

/**
 * Presale Operations
 */

// Add presale purchase
async function addPresalePurchase(purchase) {
    try {
        const result = await pool.query(
            `INSERT INTO presale_purchases 
             (wallet_address, token_amount, payment_method, payment_amount, usd_amount, status, stripe_session_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                purchase.wallet_address,
                purchase.token_amount,
                purchase.payment_method,
                purchase.payment_amount,
                purchase.usd_amount,
                purchase.status || 'pending',
                purchase.stripe_session_id || null
            ]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error adding presale purchase:', error);
        throw error;
    }
}

// Get presale purchases for address
async function getPresalePurchases(address) {
    try {
        const result = await pool.query(
            `SELECT * FROM presale_purchases 
             WHERE LOWER(wallet_address) = LOWER($1) 
             ORDER BY created_at DESC`,
            [address]
        );
        return result.rows;
    } catch (error) {
        console.error('Error getting presale purchases:', error);
        throw error;
    }
}

// Get all presale purchases
async function getAllPresalePurchases() {
    try {
        const result = await pool.query(
            `SELECT * FROM presale_purchases ORDER BY created_at DESC`
        );
        return result.rows;
    } catch (error) {
        console.error('Error getting all presale purchases:', error);
        throw error;
    }
}

// Get presale purchase by ID
async function getPresalePurchaseById(id) {
    try {
        const result = await pool.query(
            `SELECT * FROM presale_purchases WHERE id = $1`,
            [id]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error getting presale purchase by ID:', error);
        throw error;
    }
}

// Get presale stats
async function getPresaleStats() {
    try {
        const result = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN status IN ('paid', 'confirmed', 'minted', 'paid_pending_mint') THEN token_amount ELSE 0 END), 0) as tokens_sold,
                COALESCE(SUM(CASE WHEN status IN ('paid', 'confirmed', 'minted', 'paid_pending_mint') THEN usd_amount ELSE 0 END), 0) as total_usd,
                COUNT(DISTINCT CASE WHEN status IN ('paid', 'confirmed', 'minted', 'paid_pending_mint') THEN wallet_address END) as unique_buyers,
                COUNT(*) as total_purchases
            FROM presale_purchases
        `);
        
        const row = result.rows[0];
        return {
            tokensSold: parseInt(row.tokens_sold) || 0,
            totalUSD: parseFloat(row.total_usd) || 0,
            uniqueBuyers: parseInt(row.unique_buyers) || 0,
            totalPurchases: parseInt(row.total_purchases) || 0
        };
    } catch (error) {
        console.error('Error getting presale stats:', error);
        return {
            tokensSold: 0,
            totalUSD: 0,
            uniqueBuyers: 0,
            totalPurchases: 0
        };
    }
}

// Update presale purchase
async function updatePresalePurchase(id, updates) {
    try {
        const fields = [];
        const values = [];
        let paramCount = 1;
        
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${paramCount++}`);
                values.push(value);
            }
        }
        
        if (fields.length === 0) {
            return await getPresalePurchaseById(id);
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await pool.query(
            `UPDATE presale_purchases SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error updating presale purchase:', error);
        throw error;
    }
}

// Update presale purchase by Stripe session ID
async function updatePresalePurchaseByStripeSession(sessionId, updates) {
    try {
        const fields = [];
        const values = [];
        let paramCount = 1;
        
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = $${paramCount++}`);
                values.push(value);
            }
        }
        
        if (fields.length === 0) {
            return null;
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(sessionId);
        
        const result = await pool.query(
            `UPDATE presale_purchases SET ${fields.join(', ')} WHERE stripe_session_id = $${paramCount} RETURNING *`,
            values
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error updating presale purchase by Stripe session:', error);
        throw error;
    }
}

/**
 * Helper Functions
 */

// Format registrant for API response
function formatRegistrant(row) {
    if (!row) return null;
    return {
        id: row.id,
        address: row.address,
        email: row.email || row.metadata?.email || null,
        minted: row.minted,
        txHash: row.tx_hash,
        tx_hash: row.tx_hash,
        registeredAt: row.registered_at,
        registered_at: row.registered_at,
        mintedAt: row.minted_at,
        signature: row.signature,
        metadata: row.metadata
    };
}

// Test database connection
async function testConnection() {
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        return true;
    } catch (error) {
        console.error('Database connection test failed:', error);
        return false;
    }
}

// Close pool (for graceful shutdown)
async function closePool() {
    await pool.end();
}

module.exports = {
    // Initialization
    initDb,
    testConnection,
    closePool,
    
    // Registrant operations
    addRegistrant,
    getRegistrant,
    getAllRegistrants,
    getPendingRegistrants,
    markAsMinted,
    updateRegistrant,
    hasRegistrant,
    getStats,
    
    // Admin operations
    getAdminUser,
    createAdminUser,
    updateAdminPassword,
    updateLastLogin,
    
    // Session operations
    createSession,
    getSession,
    deleteSession,
    cleanExpiredSessions,
    
    // Presale operations
    addPresalePurchase,
    getPresalePurchases,
    getAllPresalePurchases,
    getPresalePurchaseById,
    getPresaleStats,
    updatePresalePurchase,
    updatePresalePurchaseByStripeSession,
    
    // Direct pool access if needed
    pool
};
