// src/middleware/auth.js
// Authentication middleware for admin routes

function requireAdminAuth(req, res, next) {
    try {
        const sessionCookie = req.cookies?.admin_session;
        
        if (!sessionCookie) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }
        
        const session = typeof sessionCookie === 'string'
            ? JSON.parse(sessionCookie)
            : sessionCookie;
        
        if (!session?.id || !session?.email) {
            return res.status(401).json({ success: false, error: 'Invalid session' });
        }
        
        // Attach session to request
        req.admin = session;
        next();
        
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(401).json({ success: false, error: 'Authentication failed' });
    }
}

function requireSuperAdmin(req, res, next) {
    if (req.admin?.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Super admin access required' });
    }
    next();
}

module.exports = {
    requireAdminAuth,
    requireSuperAdmin
};
