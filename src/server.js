// src/server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// DEBUG: Log ALL incoming requests
app.use((req, res, next) => {
    console.log(`📥 [${req.method}] ${req.path}`);
    next();
})

// ========================================
// STATIC FILES FIRST - NO AUTH REQUIRED
// ========================================
const publicPath = path.join(__dirname, 'public');

// These routes serve static files directly, before any other middleware
app.use('/images', express.static(path.join(publicPath, 'images')));
app.use('/fonts', express.static(path.join(publicPath, 'fonts')));
app.use('/css', express.static(path.join(publicPath, 'css')));
app.use('/js', express.static(path.join(publicPath, 'js')));
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(publicPath, 'favicon.ico'), err => {
        if (err) res.status(404).end();
    });
});
app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(publicPath, 'robots.txt'), err => {
        if (err) res.status(404).end();
    });
});

// ========================================
// STANDARD MIDDLEWARE
// ========================================

// CORS configuration
app.use(cors({
    origin: true,
    credentials: true
}));

// Cookie parser
app.use(cookieParser());

// Stripe webhook needs raw body - must be before JSON parser
const stripeRoutes = require('./routes/stripe');
app.use('/api/stripe', stripeRoutes);

// JSON and URL-encoded parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// ROUTES
// ========================================
const routes = require('./routes');
app.use('/', routes);

// General static files (for anything not caught above)
app.use(express.static(publicPath));

// Catch-all redirect (but not for static assets or API)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.includes('.')) {
        return next();
    }
    res.redirect('/');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
