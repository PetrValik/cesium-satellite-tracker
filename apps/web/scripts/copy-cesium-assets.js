import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the cesium package root wherever npm hoisted it (workspace-safe).
const require = createRequire(import.meta.url);
const cesiumRoot = dirname(require.resolve('cesium'));

const sourceDir = join(cesiumRoot, 'Build', 'Cesium');
const destDir = join(__dirname, '..', 'public', 'cesium');

function copyRecursiveSync(src, dest) {
    const exists = statSync(src, { throwIfNoEntry: false });
    if (!exists) {
        console.log(`Source directory not found: ${src}`);
        return;
    }

    const isDirectory = exists.isDirectory();
    if (isDirectory) {
        mkdirSync(dest, { recursive: true });
        readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(join(src, childItemName), join(dest, childItemName));
        });
    } else {
        copyFileSync(src, dest);
    }
}

console.log('Copying Cesium assets...');
try {
    copyRecursiveSync(sourceDir, destDir);
    console.log('✓ Cesium assets copied successfully');
} catch (error) {
    console.error('Failed to copy Cesium assets:', error.message);
    process.exit(1);
}
