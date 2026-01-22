const crypto = require('crypto');
const db = require('./db-postgres');

// Default admin credentials (only used if no admin exists)
const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'keavalley2024';

/**
 * Hash password using SHA-256 (simple, for demo purposes)
 * For production, use bcrypt
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Generate session ID
 */
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Initialize admin user if not exists
 */
async function initializeAdmin() {
    try {
        const existingAdmin = await db.getAdminUser(DEFAULT_USERNAME);
        if (!existingAdmin) {
            const passwordHash = hashPassword(DEFAULT_PASSWORD);
            await db.createAdminUser(DEFAULT_USERNAME, passwordHash, true);
            console.log('✅ Default admin user created');
            console.log(`   Username: ${DEFAULT_USERNAME}`);
            console.log(`   Password: ${DEFAULT_PASSWORD}`);
            console.log('   ⚠️  Please change the password on first login!');
        }
    } catch (error) {
        console.error('Error initializing admin:', error);
    }
}

/**
 * Authenticate user
 */
async function authenticate(username, password) {
    try {
        const user = await db.getAdminUser(username);
        if (!user) {
            return { success: false, error: 'Invalid credentials' };
        }

        const passwordHash = hashPassword(password);
        if (user.password_hash !== passwordHash) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Create session
        const sessionId = generateSessionId();
        await db.createSession(sessionId, username);
        await db.updateLastLogin(username);

        return {
            success: true,
            sessionId,
            username,
            mustChangePassword: user.must_change_password
        };
    } catch (error) {
        console.error('Authentication error:', error);
        return { success: false, error: 'Authentication failed' };
    }
}

/**
 * Validate session
 */
async function validateSession(sessionId) {
    if (!sessionId) return null;
    
    try {
        const session = await db.getSession(sessionId);
        if (!session) return null;

        const user = await db.getAdminUser(session.username);
        if (!user) return null;

        return {
            username: session.username,
            mustChangePassword: user.must_change_password
        };
    } catch (error) {
        console.error('Session validation error:', error);
        return null;
    }
}

/**
 * Change password
 */
async function changePassword(username, newPassword) {
    try {
        if (!newPassword || newPassword.length < 8) {
            return { success: false, error: 'Password must be at least 8 characters' };
        }

        const passwordHash = hashPassword(newPassword);
        const result = await db.updateAdminPassword(username, passwordHash, false);
        
        if (!result) {
            return { success: false, error: 'User not found' };
        }

        return { success: true };
    } catch (error) {
        console.error('Change password error:', error);
        return { success: false, error: 'Failed to change password' };
    }
}

/**
 * Logout - destroy session
 */
async function logout(sessionId) {
    if (sessionId) {
        await db.deleteSession(sessionId);
    }
}

/**
 * Print first run banner
 */
function printFirstRunBanner() {
    console.log('\n' + '='.repeat(50));
    console.log('  KEA VALLEY AUTO-MINTER - Admin Setup');
    console.log('='.repeat(50));
}

module.exports = {
    initializeAdmin,
    authenticate,
    validateSession,
    changePassword,
    logout,
    hashPassword,
    generateSessionId,
    printFirstRunBanner
};
