// scripts/import-service-images.js
//
// Moves marketplace service images off the local filesystem and into Postgres,
// so every server serves the same files instead of relying on whatever happens
// to sit on one machine's disk.
//
// Run it from the machine that has the image files:
//     node scripts/import-service-images.js
//     node scripts/import-service-images.js "C:/path/to/some/other/folder"
//
// Filenames are preserved, so the image_url already stored on each service keeps
// working. Re-running is safe: images already in the database are left alone
// unless --force is passed.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/db-postgres');
const imageStore = require('../src/services/image-store');

const MIME_BY_EXTENSION = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
};

const force = process.argv.includes('--force');
const sourceDir = process.argv.slice(2).find(arg => !arg.startsWith('--'))
    || path.join(__dirname, '../src/public/images/services');

async function main() {
    if (!fs.existsSync(sourceDir)) {
        console.error(`❌ Folder not found: ${sourceDir}`);
        process.exit(1);
    }

    console.log(`📂 Reading images from ${sourceDir}\n`);
    await imageStore.ensureTable();

    const services = await db.pool.query(
        `SELECT id, name, image_url FROM marketplace_services
         WHERE image_url LIKE '/images/services/%'`
    );

    // Several services can share one image, so collect the distinct filenames
    const referenced = new Map();
    for (const service of services.rows) {
        const filename = imageStore.filenameFromUrl(service.image_url);
        if (!filename) {
            console.log(`⚠️  Skipping unsupported image name for "${service.name}": ${service.image_url}`);
            continue;
        }
        if (!referenced.has(filename)) referenced.set(filename, []);
        referenced.get(filename).push(service.name);
    }

    const imported = [];
    const skipped = [];
    const missing = [];

    for (const [filename, serviceNames] of referenced) {
        if (!force && await imageStore.get(filename)) {
            skipped.push(filename);
            continue;
        }

        const filePath = path.join(sourceDir, filename);
        if (!fs.existsSync(filePath)) {
            missing.push({ filename, serviceNames });
            continue;
        }

        const mimeType = MIME_BY_EXTENSION[path.extname(filename).toLowerCase()];
        if (!mimeType) {
            console.log(`⚠️  Unsupported file type, skipping: ${filename}`);
            continue;
        }

        const buffer = fs.readFileSync(filePath);
        await imageStore.save(buffer, mimeType, { filename });
        imported.push({ filename, bytes: buffer.length });
        console.log(`✅ Stored ${filename} (${(buffer.length / 1024).toFixed(0)} KB) — ${serviceNames.join(', ')}`);
    }

    console.log(`\n────────────────────────────────────────`);
    console.log(`imported:        ${imported.length}`);
    console.log(`already stored:  ${skipped.length}`);
    console.log(`still missing:   ${missing.length}`);

    if (missing.length) {
        console.log(`\n⚠️  No file found for these — re-upload them in the admin, or run this`);
        console.log(`   script again from the machine that has them:\n`);
        for (const { filename, serviceNames } of missing) {
            console.log(`   ${filename}  →  ${serviceNames.join(', ')}`);
        }
    }

    await db.pool.end();
}

main().catch(async (error) => {
    console.error('❌ Import failed:', error.message);
    try { await db.pool.end(); } catch (e) { /* already closing */ }
    process.exit(1);
});
