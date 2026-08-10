// src/services/image-store.js
// Persistent storage for admin-uploaded marketplace images.
//
// Uploads used to be written to src/public/images/services with multer.diskStorage.
// That only works on a long-lived server with a writable disk: on Vercel the
// deployment filesystem is read-only and per-instance, so an image "uploaded" in
// production never landed anywhere the site could serve it back - it only survived
// on the machine of whoever ran the upload locally. Images now live in Postgres,
// so every instance serves the same files.

const db = require('../db-postgres');

const URL_PREFIX = '/images/services/';

const MIME_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
};

const TABLE_DDL = `
    CREATE TABLE IF NOT EXISTS service_images (
        filename   VARCHAR(255) PRIMARY KEY,
        mime_type  VARCHAR(100) NOT NULL,
        size_bytes INTEGER NOT NULL,
        data       BYTEA NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
`;

let ensurePromise = null;

// Created lazily instead of in initDb() so a cold start that never uploads pays
// nothing, and a failed CREATE can be retried by the next request.
function ensureTable() {
    if (!ensurePromise) {
        ensurePromise = db.pool.query(TABLE_DDL).catch(error => {
            ensurePromise = null;
            throw error;
        });
    }
    return ensurePromise;
}

// Generated names only - keeps the serving route free of traversal tricks.
function isSafeFilename(filename) {
    return typeof filename === 'string'
        && filename.length > 0
        && filename.length <= 255
        && /^[A-Za-z0-9._-]+$/.test(filename)
        && !filename.includes('..');
}

function isSupportedMimeType(mimeType) {
    return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mimeType);
}

function buildFilename(mimeType) {
    const extension = MIME_EXTENSIONS[mimeType] || '.jpg';
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
}

function urlFor(filename) {
    return `${URL_PREFIX}${filename}`;
}

// Returns null for anything that isn't a stored service image URL.
function filenameFromUrl(imageUrl) {
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith(URL_PREFIX)) return null;
    const filename = decodeURIComponent(imageUrl.slice(URL_PREFIX.length));
    return isSafeFilename(filename) ? filename : null;
}

// Pass options.filename to keep an existing name (used when importing images that
// services already reference); otherwise a fresh unique name is generated.
async function save(buffer, mimeType, options = {}) {
    await ensureTable();

    const filename = options.filename || buildFilename(mimeType);
    if (!isSafeFilename(filename)) {
        throw new Error(`Unsafe image filename: ${filename}`);
    }

    await db.pool.query(`
        INSERT INTO service_images (filename, mime_type, size_bytes, data)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (filename) DO UPDATE SET
            mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            data = EXCLUDED.data
    `, [filename, mimeType, buffer.length, buffer]);

    return { filename, imageUrl: urlFor(filename) };
}

async function get(filename) {
    if (!isSafeFilename(filename)) return null;

    try {
        const result = await db.pool.query(
            'SELECT mime_type, data FROM service_images WHERE filename = $1',
            [filename]
        );
        return result.rows[0] || null;
    } catch (error) {
        // 42P01: table not created yet - nothing has been uploaded on this database
        if (error.code === '42P01') return null;
        throw error;
    }
}

async function remove(filename) {
    if (!isSafeFilename(filename)) return false;

    try {
        const result = await db.pool.query('DELETE FROM service_images WHERE filename = $1', [filename]);
        return result.rowCount > 0;
    } catch (error) {
        if (error.code === '42P01') return false;
        throw error;
    }
}

module.exports = {
    URL_PREFIX,
    ensureTable,
    isSafeFilename,
    isSupportedMimeType,
    urlFor,
    filenameFromUrl,
    save,
    get,
    remove
};
