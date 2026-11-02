/**
 * FileSystemService
 *
 * Manages app-private persistent storage for processed report images.
 * Uses react-native-fs for all file I/O.
 *
 * All images are stored under:
 *   {DocumentDirectoryPath}/reports/{reportId}/{imageId}.jpg
 *
 * This directory survives app restarts and Android process death.
 * It is NOT cleared by the OS until the app is uninstalled or the user
 * manually clears app data.
 */
import RNFS from 'react-native-fs';

const REPORTS_BASE = `${RNFS.DocumentDirectoryPath}/reports`;

export async function ensureReportDirectory(reportId: string): Promise<string> {
  const dir = `${REPORTS_BASE}/${reportId}`;
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
  return dir;
}

export function getImagePath(reportId: string, imageId: string): string {
  return `${REPORTS_BASE}/${reportId}/${imageId}.jpg`;
}

export async function copyToAppStorage(
  sourceUri: string,
  reportId: string,
  imageId: string,
): Promise<string> {
  await ensureReportDirectory(reportId);
  const dest = getImagePath(reportId, imageId);
  // Handle Android content:// URIs and file:// URIs uniformly
  await RNFS.copyFile(sourceUri.replace('file://', ''), dest);
  return dest;
}

export async function fileExists(path: string): Promise<boolean> {
  return RNFS.exists(path);
}

export async function getFileSize(path: string): Promise<number> {
  const stat = await RNFS.stat(path);
  return stat.size;
}

export async function deleteFile(path: string): Promise<void> {
  const exists = await RNFS.exists(path);
  if (exists) {
    await RNFS.unlink(path);
  }
}

export async function deleteReportDirectory(reportId: string): Promise<void> {
  const dir = `${REPORTS_BASE}/${reportId}`;
  const exists = await RNFS.exists(dir);
  if (exists) {
    await RNFS.unlink(dir);
  }
}

export async function deleteAllReportFiles(): Promise<void> {
  const exists = await RNFS.exists(REPORTS_BASE);
  if (exists) {
    await RNFS.unlink(REPORTS_BASE);
  }
}

/**
 * Startup reconciliation: returns a list of report directories that exist on
 * disk.  The caller compares this against SQLite to detect orphaned files.
 */
export async function listReportDirectories(): Promise<string[]> {
  const exists = await RNFS.exists(REPORTS_BASE);
  if (!exists) return [];
  const items = await RNFS.readDir(REPORTS_BASE);
  return items.filter(i => i.isDirectory()).map(i => i.name);
}

/**
 * Reconcile: for each image expected by SQLite, verify its local file exists.
 * Returns an array of image IDs whose files are missing.
 */
export async function findMissingFiles(
  images: Array<{ id: string; localPath: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const img of images) {
    const exists = await RNFS.exists(img.localPath);
    if (!exists) missing.push(img.id);
  }
  return missing;
}
