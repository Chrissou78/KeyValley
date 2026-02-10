// src/server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

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
// STATIC FILES FIRST (no auth required)
// ========================================
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/admin/js', express.static(path.join(__dirname, 'public/admin/js')));
app.use('/admin/css', express.static(path.join(__dirname, 'public/admin/css')));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// ROUTES AFTER STATIC FILES
// ========================================
const routes = require('./routes');
app.use('/', routes);

// Catch-all redirect (but not for static assets)
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
