// src/middleware/member-gate.js
// Keeps the public site behind membership: a visitor who has not signed in with
// WalletTwo is sent to /welcome.
//
// The cookie is issued ONLY in routes/wallettwo-auth.js, after WalletTwo has
// verified the login server-side, and it is signed and httpOnly. Membership
// therefore cannot be granted by editing localStorage or hand-writing a cookie,
// which is what makes this an actual gate rather than a decoration.

const crypto = require('crypto');
const path = require('path');

// Served in place at / so the site's front door IS the members page, rather
// than a public page that bounces somewhere else.
const GATE_PAGE = path.join(__dirname, '../public/welcome/index.html');
const ROOT_PATHS = ['/', '/index.html'];

const COOKIE_NAME = 'kv_member';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Prefer a dedicated secret; fall back to an existing one so the gate works
// without new configuration on the server.
function secret() {
    const value = process.env.MEMBER_GATE_SECRET || process.env.WALLETTWO_API_KEY;
    if (!value) {
        console.warn('⚠️  No MEMBER_GATE_SECRET or WALLETTWO_API_KEY set — member gate cannot sign cookies');
        return null;
    }
    return value;
}

function sign(data) {
    return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

// Paths that must stay reachable: the gate itself, the admin area, the legal
// pages the gate links to, the API, and every static asset the gate renders with.
const OPEN_PREFIXES = [
    '/welcome',
    '/admin',
    '/login',
    '/api/',
    '/images/',
    '/js/',
    '/css/',
    '/fonts/',
    '/terms',
    '/privacy'
];

const OPEN_EXACT = ['/favicon.ico', '/robots.txt', '/site.webmanifest'];

function isOpenPath(pathname) {
    if (OPEN_EXACT.includes(pathname)) return true;
    return OPEN_PREFIXES.some(prefix =>
        prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(prefix + '/')
    );
}

// Mark the cookie Secure whenever the request actually arrived over HTTPS.
// Reading it from the request rather than NODE_ENV means the flag is right on
// the VPS, on Vercel and on plain-HTTP localhost with nothing to configure.
function isHttps(req) {
    if (!req) return false;
    if (req.secure) return true;
    const forwarded = req.headers && req.headers['x-forwarded-proto'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim() === 'https';
    }
    return false;
}

function issueMemberCookie(res, member) {
    if (!secret()) return false;

    const payload = {
        sub: member.sub || null,
        email: member.email || null,
        wallet: member.wallet || null,
        exp: Date.now() + MAX_AGE_MS
    };

    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const value = `${body}.${sign(body)}`;

    res.cookie(COOKIE_NAME, value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps(res.req),
        maxAge: MAX_AGE_MS,
        path: '/'
    });

    return true;
}

function clearMemberCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readMember(req) {
    const raw = req.cookies?.[COOKIE_NAME];
    if (!raw || !secret()) return null;

    const [body, signature] = raw.split('.');
    if (!body || !signature) return null;

    // Constant-time compare so the signature can't be guessed byte by byte
    const expected = sign(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function isMember(req) {
    return readMember(req) !== null;
}

function memberGate(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isOpenPath(req.path)) return next();

    // The response for a gated path depends on the membership cookie, so no
    // shared cache may reuse one visitor's copy for another.
    res.set('Vary', 'Cookie');
    res.set('Cache-Control', 'no-store, private');

    if (isMember(req)) return next();

    // A browser navigation gets sent to the gate. Anything else asking for a
    // gated path - curl, fetch, a scraper - is refused outright: these send
    // "Accept: */*", so keying only on text/html would hand them the page.
    // At the root, render the gate in place: a visitor typing kea-valley.com
    // should land on the members page itself, with the address bar unchanged.
    // This is served to every client, crawlers and link-preview bots included -
    // the door is meant to be seen, and there is nothing behind it to leak.
    if (ROOT_PATHS.includes(req.path)) {
        return res.sendFile(GATE_PAGE, err => {
            if (err) {
                console.error('Failed to serve gate page:', err.message);
                res.redirect(302, '/welcome');
            }
        });
    }

    // Past the door it is members only. A browser navigation is redirected to
    // the gate; anything else - curl, fetch, a scraper - is refused, since those
    // send "Accept: */*" and keying only on text/html would hand them the page.
    const accepts = req.headers.accept || '';
    const isNavigation = accepts.includes('text/html') || req.headers['sec-fetch-mode'] === 'navigate';

    if (!isNavigation) {
        return res.status(403).json({ error: 'Members only', gate: '/welcome' });
    }

    const next_ = encodeURIComponent(req.originalUrl || req.path);
    return res.redirect(302, `/welcome?next=${next_}`);
}

module.exports = {
    COOKIE_NAME,
    memberGate,
    issueMemberCookie,
    clearMemberCookie,
    readMember,
    isMember,
    isOpenPath
};
