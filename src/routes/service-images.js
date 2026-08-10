// src/routes/service-images.js
// Serves marketplace service images stored in Postgres.
//
// Mounted at /images/services AFTER express.static('/images'), so the legacy
// images committed to the repo keep being served from disk and only the ones
// uploaded through the admin fall through to the database.

const express = require('express');
const router = express.Router();
const imageStore = require('../services/image-store');

router.get('/:filename', async (req, res) => {
    const { filename } = req.params;

    if (!imageStore.isSafeFilename(filename)) {
        return res.status(404).end();
    }

    try {
        const image = await imageStore.get(filename);
        if (!image) {
            return res.status(404).end();
        }

        // Filenames are unique per upload, so the bytes never change.
        res.set('Content-Type', image.mime_type);
        res.set('Content-Length', image.data.length);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('ETag', `"${filename}"`);
        res.end(image.data);
    } catch (error) {
        console.error('Serve service image error:', error);
        res.status(500).end();
    }
});

module.exports = router;
