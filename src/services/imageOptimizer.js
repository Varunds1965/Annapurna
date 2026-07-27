/**
 * Image Optimizer — uses sharp to resize/compress uploads
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const QUALITY = 80;
const THUMB_SIZE = 200;

/**
 * Optimize an uploaded image file in-place
 * @param {string} filePath - path to the uploaded file
 * @returns {{ optimized: boolean, originalSize: number, newSize: number, thumbnailPath: string }}
 */
async function optimizeImage(filePath) {
  const stats = fs.statSync(filePath);
  const originalSize = stats.size;

  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return { optimized: false, reason: 'unsupported format' };
  }

  // Resize and compress
  const buffer = await sharp(filePath)
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  // Replace original with optimized webp version
  const webpPath = filePath.replace(ext, '.webp');
  fs.writeFileSync(webpPath, buffer);

  // Generate thumbnail
  const thumbPath = filePath.replace(ext, '_thumb.webp');
  await sharp(filePath)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .webp({ quality: 70 })
    .toFile(thumbPath);

  // Remove original if different filename
  if (webpPath !== filePath) {
    fs.unlinkSync(filePath);
  }

  const newSize = buffer.length;
  return {
    optimized: true,
    originalSize,
    newSize,
    savedBytes: originalSize - newSize,
    filePath: webpPath,
    thumbnailPath: thumbPath,
    filename: path.basename(webpPath),
    thumbnailFilename: path.basename(thumbPath),
  };
}

module.exports = { optimizeImage };