// src/routes/static.js
// Static page routes - preserved exactly from old server.js

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Home page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Claim pages
router.get('/claim', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/claim/index.html'));
});

router.get('/claim/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/claim/index.html'));
});

router.get('/claim/questionnaire', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/claim/questionnaire.html'));
});

router.get('/claim/questionnaire.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/claim/questionnaire.html'));
});

// Profile page
router.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile/index.html'));
});

router.get('/profile/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile/index.html'));
});

// Presale page
router.get('/presale', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/presale/index.html'));
});

router.get('/presale/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/presale/index.html'));
});

// Login page
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login/index.html'));
});

// Dashboard (admin) - WITH SESSION CHECK
router.get('/dashboard', (req, res) => {
  console.log('🔍 Dashboard - All cookies:', req.cookies);
  console.log('🔍 admin_session raw:', req.cookies?.admin_session);
  
  const sessionCookie = req.cookies?.admin_session;
  
  if (!sessionCookie) {
    console.log('❌ No session cookie');
    return res.redirect('/login');
  }
  
  console.log('🔍 Session cookie type:', typeof sessionCookie);
  console.log('🔍 Session cookie value:', sessionCookie);
  
  try {
    // If it's already an object (cookie-parser might parse JSON automatically)
    const session = typeof sessionCookie === 'string' 
      ? JSON.parse(sessionCookie) 
      : sessionCookie;
    
    console.log('🔍 Parsed session:', session);
    
    if (!session?.id || !session?.email) {
      console.log('❌ Invalid session data');
      return res.redirect('/login');
    }
    
    console.log('✅ Valid session, serving dashboard');
    res.sendFile(path.join(__dirname, '../public/admin/index.html'));
  } catch (e) {
    console.log('❌ Parse error:', e.message);
    res.redirect('/login');
  }
});

// Terms and Privacy
router.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms/index.html'));
});

router.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy/index.html'));
});

// Debug route (can be removed in production)
router.get('/debug-claim', (req, res) => {
  const claimPath = path.join(__dirname, '../public/claim/index.html');
  res.json({
    filePath: claimPath,
    exists: fs.existsSync(claimPath),
    dirname: __dirname,
    files: fs.existsSync(path.join(__dirname, '../public/claim'))
      ? fs.readdirSync(path.join(__dirname, '../public/claim'))
      : 'folder not found'
  });
});

module.exports = router;