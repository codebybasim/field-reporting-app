/**
 * ImageProcessor
 *
 * Accepts a raw camera/gallery URI and produces a compressed JPEG that is:
 *   • smaller than 5 MB (hard limit enforced by iterative compression)
 *   • approximately 4.5 MB target for safety margin
 *   • stored in app-private persistent storage
 *   • accompanied by its SHA-256 checksum
 *
 * URI conventions:
 *   - ImageResizer.createResizedImage() — source URI passed as-is (supports
 *     file://, content:// and bare paths).
 *   - outputPath — pass null; the library treats this as a DIRECTORY and
 *     appends its own random filename. Passing a file path causes
 *     "No such file or directory" because the library tries to create a
 *     file inside what it thinks is a folder.
 *   - result.path — bare absolute path (no scheme) — use directly with RNFS.
 *   - result.size — file size in bytes, returned by the library.
 *   - RNFS.hash / RNFS.copyFile / RNFS.unlink — all want bare paths.
 */
import ImageResizer from '@bam.tech/react-native-image-resizer';
import RNFS from 'react-native-fs';
import {
  copyToAppStorage,
  ensureReportDirectory,
  deleteFile,
} from '../filesystem/FileSystemService';
import type { ProcessedImage } from '../../types';

const TARGET_BYTES = 4.5 * 1024 * 1024;  // 4.5 MB
const MAX_BYTES = 5 * 1024 * 1024;   // 5 MB hard ceiling
const MAX_DIMENSION = 2400;                 // px — largest side

const QUALITY_STEPS = [85, 75, 65, 55, 45, 35, 25];

// ─── URI helpers ──────────────────────────────────────────────────────────────

/**
 * Convert any URI form to a bare absolute path for RNFS operations.
 *   file:///data/...  →  /data/...
 *   file://data/...   →  /data/...
 *   /data/...         →  /data/...  (already a path)
 */
function uriToPath(uri: string): string {
  if (uri.startsWith('file:///')) return uri.slice(7);
  if (uri.startsWith('file://')) return uri.slice(6);
  return uri;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processImage(
  sourceUri: string,
  reportId: string,
  imageId: string,
): Promise<ProcessedImage> {

  // Pre-create the persistent report directory
  await ensureReportDirectory(reportId);

  // ── Best-effort original size (fails silently for content:// URIs) ────────
  let originalSize = 0;
  try {
    const sourcePath = uriToPath(sourceUri);
    if (sourcePath.startsWith('/')) {
      const stat = await RNFS.stat(sourcePath);
      originalSize = stat.size;
    }
  } catch {
    // content:// or permission denied — not fatal
  }

  let lastTempPath: string | null = null;
  let processedSize = 0;
  let width = 0;
  let height = 0;

  // ── Iterative compression ─────────────────────────────────────────────────
  for (let qi = 0; qi < QUALITY_STEPS.length; qi++) {
    const quality = QUALITY_STEPS[qi];

    let result: Awaited<ReturnType<typeof ImageResizer.createResizedImage>>;
    try {
      // outputPath = null → library uses its own cache dir and generates
      // a random filename. We read the path back from result.path.
      result = await ImageResizer.createResizedImage(
        sourceUri,          // source — pass through as-is (content:// OK)
        MAX_DIMENSION,
        MAX_DIMENSION,
        'JPEG',
        quality,
        0,                  // rotation 0 — EXIF orientation preserved by library
        null,               // outputPath = null (NOT a file path — it's a directory!)
        false,              // keepMeta
        { mode: 'contain', onlyScaleDown: true },
      );
    } catch (resizerErr) {
      if (lastTempPath) await deleteFile(lastTempPath).catch(() => { });
      throw new Error(
        `ImageResizer failed at quality ${quality}: ${resizerErr instanceof Error ? resizerErr.message : String(resizerErr)
        }`,
      );
    }

    width = result.width;
    height = result.height;
    processedSize = result.size;   // library returns file size directly

    // result.path is a bare absolute path (no file:// scheme)
    const resultPath = result.path;

    // Verify the output file was actually written
    const fileExists = await RNFS.exists(resultPath);
    if (!fileExists) {
      if (lastTempPath) await deleteFile(lastTempPath).catch(() => { });
      throw new Error(
        `ImageResizer reported success but output file not found: ${resultPath}`,
      );
    }

    // Delete previous iteration's temp file (different path from this one)
    if (lastTempPath && lastTempPath !== resultPath) {
      await deleteFile(lastTempPath).catch(() => { });
    }
    lastTempPath = resultPath;

    if (processedSize <= TARGET_BYTES) {
      break; // within target — stop compressing
    }

    // Last quality step and still over hard limit
    if (qi === QUALITY_STEPS.length - 1 && processedSize > MAX_BYTES) {
      await deleteFile(lastTempPath).catch(() => { });
      throw new Error(
        `Image cannot be compressed below 5 MB (${(processedSize / 1024 / 1024).toFixed(1)} MB at minimum quality). ` +
        `Try a lower-resolution source image.`,
      );
    }
  }

  if (!lastTempPath) {
    throw new Error('Image processing produced no output file.');
  }

  // ── SHA-256 checksum (RNFS.hash takes a bare path) ───────────────────────
  const checksum = await RNFS.hash(lastTempPath, 'sha256');

  // ── Copy to app-private persistent storage ───────────────────────────────
  const persistentPath = await copyToAppStorage(lastTempPath, reportId, imageId);

  // ── Clean up temp ─────────────────────────────────────────────────────────
  await deleteFile(lastTempPath).catch(() => { });

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
