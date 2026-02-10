// src/server.js
// Simplified Express server setup

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

// Mount all routes BEFORE static files
const routes = require('./routes');
app.use('/', routes);

// Static files AFTER routes (so routes take priority)
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all redirect (but not for static assets)
app.get('*', (req, res, next) => {
    // Don't redirect API calls or static assets
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
