const crypto = require('crypto');

// Simple token-based auth for serverless
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.PRIVATE_KEY || 'kea-valley-default-secret';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'kea-valley-salt').digest('hex');
}

function generateSessionToken(username) {
    const expiry = Date.now() + SESSION_DURATION;
    const data = `${username}:${expiry}`;
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
    return Buffer.from(`${data}:${signature}`).toString('base64');
}

function validateSessionToken(token) {
    try {
        if (!token) return null;
        
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split(':');
        
        if (parts.length !== 3) return null;
        
        const [username, expiry, signature] = parts;
        const data = `${username}:${expiry}`;
        const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
        
        if (signature !== expectedSignature) {
            console.log('Invalid session signature');
            return null;
        }
        
        if (Date.now() > parseInt(expiry)) {
            console.log('Session expired');
            return null;
        }
        
        return { username, expiry: parseInt(expiry) };
    } catch (error) {
        console.error('Session validation error:', error.message);
        return null;
    }
}

function getCredentials() {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD;
    
    if (!password) {
        console.warn('⚠️ ADMIN_PASSWORD not set in environment variables');
        return null;
    }
    
    return {
        username,
        passwordHash: hashPassword(password)
    };
}

function login(username, password) {
    const credentials = getCredentials();
    
    if (!credentials) {
        return { success: false, error: 'Admin credentials not configured. Set ADMIN_PASSWORD in environment variables.' };
    }
    
    if (username !== credentials.username) {
        return { success: false, error: 'Invalid credentials' };
    }
    
    const passwordHash = hashPassword(password);
    if (passwordHash !== credentials.passwordHash) {
        return { success: false, error: 'Invalid credentials' };
    }
    
    const sessionId = generateSessionToken(username);
    
    console.log('✅ Login successful for user:', username);
    
    return {
        success: true,
        sessionId,
        mustChangePassword: false
    };
}

function validateSession(sessionId) {
    const session = validateSessionToken(sessionId);
    if (!session) return null;
    
    return {
        username: session.username,
        mustChangePassword: false
    };
}

function logout(sessionId) {
    // With token-based auth, logout is handled client-side by deleting the cookie
    return true;
}

function changePassword(username, currentPassword, newPassword) {
    // In serverless with env vars, password changes must be done in Vercel dashboard
    return { 
        success: false, 
        error: 'Password changes must be done in Vercel Environment Variables dashboard' 
    };
}

function printFirstRunBanner() {
    const credentials = getCredentials();
    if (!credentials) {
        console.log('');
        console.log('⚠️  ═══════════════════════════════════════');
        console.log('⚠️  ADMIN_PASSWORD not set!');
        console.log('⚠️  Set ADMIN_PASSWORD in Vercel Environment Variables');
        console.log('⚠️  ═══════════════════════════════════════');
        console.log('');
    } else {
        console.log('✅ Admin credentials configured');
    }
}

function initCredentials() {
    return getCredentials();
}

module.exports = {
    login,
    validateSession,
    logout,
    changePassword,
    printFirstRunBanner,
    initCredentials
};
