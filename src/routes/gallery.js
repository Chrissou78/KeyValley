const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// GET /:residence - returns list of images in a residence gallery folder
router.get('/:residence', (req, res) => {
    const residence = req.params.residence;
    
    // Validate residence name to prevent directory traversal
    const allowedResidences = ['kea', 'johan-nikolao', 'kea-heights'];
    if (!allowedResidences.includes(residence)) {
        return res.status(400).json({ error: 'Invalid residence' });
    }
    
    const galleryPath = path.join(__dirname, '../public/images/residences', residence);
    
    console.log('Looking for gallery at:', galleryPath);
    
    // Check if directory exists
    if (!fs.existsSync(galleryPath)) {
        console.log('Directory NOT found:', galleryPath);
        return res.json({ images: [] });
    }
    
    // Read directory and filter for image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    
    try {
        const files = fs.readdirSync(galleryPath)
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExtensions.includes(ext);
            })
            .sort((a, b) => {
                // Natural sort (1, 2, 10 instead of 1, 10, 2)
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            })
            .map(file => `/images/residences/${residence}/${file}`);
        
        console.log(`Found ${files.length} images for ${residence}`);
        
        res.json({ images: files });
    } catch (error) {
        console.error('Error reading gallery folder:', error);
        res.status(500).json({ error: 'Failed to read gallery' });
    }
});

module.exports = router;
