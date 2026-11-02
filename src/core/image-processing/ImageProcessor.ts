/**
 * ImageProcessor
 *
 * Accepts a raw camera/gallery URI and produces a compressed JPEG that is:
 *   • smaller than 5 MB (hard limit)
 *   • approximately 4.5 MB target for safety margin
 *   • stored in app-private persistent storage
 *   • accompanied by its SHA-256 checksum
 *
 * Processing steps:
 *   1. Copy source to a temp location to resolve Android content:// URIs.
 *   2. Resize if largest dimension exceeds 2400 px.
 *   3. Compress at decreasing quality until output < 4.5 MB.
 *   4. Verify final file size.
 *   5. Compute SHA-256 checksum.
 *   6. Move to app-private persistent storage.
 *
 * Never loads image binary data into JavaScript memory.
 */
import ImageResizer from '@bam.tech/react-native-image-resizer';
import RNFS from 'react-native-fs';
import { copyToAppStorage, deleteFile, getFileSize } from '../filesystem/FileSystemService';
import type { ProcessedImage } from '../../types';

const TARGET_BYTES = 4.5 * 1024 * 1024;   // 4.5 MB
const MAX_BYTES    = 5   * 1024 * 1024;    // 5 MB hard ceiling
const MAX_DIMENSION = 2400;                 // pixels

const QUALITY_STEPS = [85, 75, 65, 55, 45, 35, 25];

export async function processImage(
  sourceUri: string,
  reportId: string,
  imageId: string,
): Promise<ProcessedImage> {
  // Determine original file size (best-effort; content:// may not give size)
  let originalSize = 0;
  try {
    const cleanPath = sourceUri.replace('file://', '');
    const stat = await RNFS.stat(cleanPath);
    originalSize = stat.size;
  } catch {
    // content:// URIs may not be stat-able; continue
  }

  let currentUri = sourceUri;
  let lastProcessedPath: string | null = null;
  let processedSize = 0;
  let width = 0;
  let height = 0;

  // ── Iterative compress ────────────────────────────────────────────────────
  for (const quality of QUALITY_STEPS) {
    const tempPath = `${RNFS.CachesDirectoryPath}/${imageId}_q${quality}.jpg`;

    const result = await ImageResizer.createResizedImage(
      currentUri,
      MAX_DIMENSION,
      MAX_DIMENSION,
      'JPEG',
      quality,
      0,         // rotation — preserve EXIF orientation instead
      tempPath,
      false,     // keep meta
      { mode: 'contain', onlyScaleDown: true },
    );

    width = result.width;
    height = result.height;

    const size = await getFileSize(result.uri.replace('file://', ''));
    processedSize = size;

    // Clean up previous temp if we're iterating
    if (lastProcessedPath && lastProcessedPath !== tempPath) {
      await deleteFile(lastProcessedPath).catch(() => {});
    }
    lastProcessedPath = result.uri.replace('file://', '');

    if (size <= TARGET_BYTES) {
      break; // good enough
    }

    if (quality === QUALITY_STEPS[QUALITY_STEPS.length - 1] && size > MAX_BYTES) {
      throw new Error(
        `Image cannot be compressed below 5 MB even at minimum quality (${(size / 1024 / 1024).toFixed(1)} MB).`,
      );
    }
  }

  if (!lastProcessedPath) {
    throw new Error('Image processing produced no output.');
  }

  // ── SHA-256 checksum ──────────────────────────────────────────────────────
  const checksum = await RNFS.hash(lastProcessedPath, 'sha256');

  // ── Move to persistent app storage ───────────────────────────────────────
  const persistentPath = await copyToAppStorage(
    lastProcessedPath,
    reportId,
    imageId,
  );

  // Clean up temp
  await deleteFile(lastProcessedPath).catch(() => {});

  return {
    localPath: persistentPath,
    originalUri: sourceUri,
    originalSize,
    processedSize,
    checksum,
    width,
    height,
    mimeType: 'image/jpeg',
  };
}
