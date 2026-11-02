// ─── Report domain types ──────────────────────────────────────────────────────

export type ReportStatus =
  | 'draft'       // composed locally, not yet queued
  | 'pending'     // queued, waiting for network
  | 'uploading'   // actively being uploaded
  | 'uploaded'    // server confirmed finalisation
  | 'failed';     // permanent failure, needs attention

export type ImageUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export interface LocalReport {
  id: string;                  // client UUID (stable idempotency key)
  description: string;
  status: ReportStatus;
  idempotencyKey: string;      // same as id, explicit for clarity
  expectedImageCount: number;
  serverId: string | null;     // populated after server creates the report
  createdAt: string;           // ISO-8601
  updatedAt: string;
}

export interface LocalReportImage {
  id: string;                  // client UUID
  reportId: string;
  localPath: string;           // absolute path in app-private storage
  storagePath: string | null;  // e.g. reports/{reportId}/{imageId}.jpg
  originalSize: number;        // bytes
  processedSize: number;       // bytes after compression
  checksum: string;            // SHA-256 hex of processed file
  uploadStatus: ImageUploadStatus;
}

export interface UploadJob {
  id: string;
  reportId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  nextAttemptAt: string | null; // ISO-8601
  lastError: string | null;
}

// ─── Server-side API response shapes ─────────────────────────────────────────

export interface ServerReport {
  id: string;
  description: string;
  status: string;
  image_count: number;
  created_at: string;
  images: ServerImage[];
}

export interface ServerImage {
  id: string;
  storage_path: string;
  checksum: string;
  file_size: number;
  public_url: string | null;
}

// ─── Image processing ─────────────────────────────────────────────────────────

export interface ProcessedImage {
  localPath: string;     // final location in app-private storage
  originalUri: string;   // source URI from picker
  originalSize: number;
  processedSize: number;
  checksum: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Main: undefined;
};

export type MainTabParamList = {
  Compose: undefined;
  Outbox: undefined;
  ServerReports: undefined;
};
