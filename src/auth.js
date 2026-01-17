const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Session storage
const sessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Credentials file path
const dataDir = path.join(__dirname, '../data');
const credentialsPath = path.join(dataDir, 'credentials.json');

function hashPassword(password) {
  const salt = 'auto-minter-salt-2024'; // Static salt (you can make this dynamic)
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length];
  }
  return password;
}

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadCredentials() {
  ensureDataDir();

  if (fs.existsSync(credentialsPath)) {
    try {
      const data = fs.readFileSync(credentialsPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading credentials file:', err.message);
    }
  }

  return null;
}

function saveCredentials(credentials) {
  ensureDataDir();
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
}

function initializeCredentials() {
  let credentials = loadCredentials();

  if (!credentials) {
    // First time setup - generate password
    const generatedPassword = generatePassword();
    
    credentials = {
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hashPassword(generatedPassword),
      createdAt: new Date().toISOString(),
      mustChangePassword: true,
    };

    saveCredentials(credentials);

    // Display the generated password
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           🔐 FIRST TIME SETUP - ADMIN CREDENTIALS          ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Username: ${credentials.username.padEnd(47)}║`);
    console.log(`║  Password: ${generatedPassword.padEnd(47)}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  SAVE THIS PASSWORD! It won\'t be shown again.          ║');
    console.log('║  You can change it after logging in.                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    return { credentials, generatedPassword, isFirstRun: true };
  }

  return { credentials, isFirstRun: false };
}

function getCredentials() {
  const credentials = loadCredentials();
  
  if (!credentials) {
    // This shouldn't happen if initializeCredentials was called at startup
    const result = initializeCredentials();
    return result.credentials;
  }

  return credentials;
}

function login(username, password) {
  const creds = getCredentials();

  if (username === creds.username && hashPassword(password) === creds.passwordHash) {
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
      username,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_DURATION,
      mustChangePassword: creds.mustChangePassword || false,
    });
    return {
      sessionId,
      mustChangePassword: creds.mustChangePassword || false,
    };
  }

  return null;
}

function validateSession(sessionId) {
  if (!sessionId) return { valid: false };

  const session = sessions.get(sessionId);
  if (!session) return { valid: false };

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return { valid: false };
  }

  return {
    valid: true,
    mustChangePassword: session.mustChangePassword,
  };
}

function changePassword(sessionId, currentPassword, newPassword) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Invalid session' };
  }

  const creds = getCredentials();

  // Verify current password
  if (hashPassword(currentPassword) !== creds.passwordHash) {
    return { success: false, error: 'Current password is incorrect' };
  }

  // Validate new password
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'New password must be at least 8 characters' };
  }

  if (newPassword === currentPassword) {
    return { success: false, error: 'New password must be different from current password' };
  }

  // Update password
  creds.passwordHash = hashPassword(newPassword);
  creds.mustChangePassword = false;
  creds.lastPasswordChange = new Date().toISOString();
  saveCredentials(creds);

  // Update session
  session.mustChangePassword = false;

  return { success: true };
}

function resetPassword() {
  const newPassword = generatePassword();
  const creds = getCredentials();

  creds.passwordHash = hashPassword(newPassword);
  creds.mustChangePassword = true;
  creds.lastPasswordChange = new Date().toISOString();
  saveCredentials(creds);

  // Clear all sessions
  sessions.clear();

  return newPassword;
}

function logout(sessionId) {
  sessions.delete(sessionId);
}

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

module.exports = {
  initializeCredentials,
  login,
  validateSession,
  changePassword,
  resetPassword,
  logout,
};
