const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const isVercel = process.env.VERCEL === '1';
const dataDir = path.join(__dirname, '..', 'data');
const credentialsPath = path.join(dataDir, 'credentials.json');

// In-memory sessions
const sessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// In-memory credentials for Vercel
let inMemoryCredentials = null;

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'kea-valley-salt').digest('hex');
}

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function generatePassword() {
    return crypto.randomBytes(12).toString('base64').slice(0, 16);
}

function loadCredentials() {
    // Use environment variables on Vercel
    if (isVercel) {
        if (inMemoryCredentials) return inMemoryCredentials;
        
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD;
        
        if (!password) {
            console.log('⚠️  Warning: ADMIN_PASSWORD not set in environment');
            return null;
        }
        
        inMemoryCredentials = {
            username,
            passwordHash: hashPassword(password),
            mustChangePassword: false
        };
        
        return inMemoryCredentials;
    }
    
    // Local: use file
    try {
        if (fs.existsSync(credentialsPath)) {
            const data = fs.readFileSync(credentialsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading credentials:', error.message);
    }
    return null;
}

function saveCredentials(credentials) {
    if (isVercel) {
        inMemoryCredentials = credentials;
        return;
    }
    
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    } catch (error) {
        console.error('Error saving credentials:', error.message);
    }
}

function initCredentials() {
    let credentials = loadCredentials();
    
    if (!credentials) {
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD || generatePassword();
        
        credentials = {
            username,
            passwordHash: hashPassword(password),
            mustChangePassword: !process.env.ADMIN_PASSWORD,
            generatedPassword: !process.env.ADMIN_PASSWORD ? password : undefined
        };
        
        saveCredentials(credentials);
    }
    
    return credentials;
}

function printFirstRunBanner() {
    const credentials = initCredentials();
    
    if (credentials.generatedPassword && !isVercel) {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     FIRST RUN - SAVE THESE CREDENTIALS ║');
        console.log('╠════════════════════════════════════════╣');
        console.log(`║  Username: ${credentials.username.padEnd(27)}║`);
        console.log(`║  Password: ${credentials.generatedPassword.padEnd(27)}║`);
        console.log('╠════════════════════════════════════════╣');
        console.log('║  You will be asked to change password  ║');
        console.log('║  on first login.                       ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('');
    }
}

function login(username, password) {
    const credentials = loadCredentials();
    
    if (!credentials) {
        return { success: false, error: 'No credentials configured' };
    }
    
    if (username !== credentials.username) {
        return { success: false, error: 'Invalid credentials' };
    }
    
    const passwordHash = hashPassword(password);
    if (passwordHash !== credentials.passwordHash) {
        return { success: false, error: 'Invalid credentials' };
    }
    
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
        username,
        createdAt: Date.now(),
        mustChangePassword: credentials.mustChangePassword || false
    });
    
    return {
        success: true,
        sessionId,
        mustChangePassword: credentials.mustChangePassword || false
    };
}

function validateSession(sessionId) {
    const session = sessions.get(sessionId);
    
    if (!session) {
        return null;
    }
    
    if (Date.now() - session.createdAt > SESSION_DURATION) {
        sessions.delete(sessionId);
        return null;
    }
    
    return session;
}

function logout(sessionId) {
    sessions.delete(sessionId);
}

function changePassword(username, currentPassword, newPassword) {
    const credentials = loadCredentials();
    
    if (!credentials || username !== credentials.username) {
        return { success: false, error: 'Invalid user' };
    }
    
    // Skip current password check if must change password
    if (!credentials.mustChangePassword) {
        const currentHash = hashPassword(currentPassword);
        if (currentHash !== credentials.passwordHash) {
            return { success: false, error: 'Current password is incorrect' };
        }
    }
    
    credentials.passwordHash = hashPassword(newPassword);
    credentials.mustChangePassword = false;
    delete credentials.generatedPassword;
    
    saveCredentials(credentials);
    
    return { success: true };
}

// Cleanup expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
        if (now - session.createdAt > SESSION_DURATION) {
            sessions.delete(sessionId);
        }
    }
}, 60 * 60 * 1000); // Every hour

module.exports = {
    login,
    validateSession,
    logout,
    changePassword,
    printFirstRunBanner,
    initCredentials
};
