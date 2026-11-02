/**
 * ReportApiService
 *
 * Thin wrapper around Supabase Edge Function calls.
 * All network errors surface as thrown Error objects — the caller decides
 * whether to retry.  Never imported by React components directly; used only
 * by the UploadCoordinator.
 */
import { supabase } from '../supabase/client';
import { ENV } from '../../utils/env';
import type { ServerReport } from '../../types';

const FUNCTIONS_URL = `${ENV.SUPABASE_URL}/functions/v1`;

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callFunction<T>(
  name: string,
  body: Record<string, unknown>,
  failureMode?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`,
  };
  if (failureMode) {
    headers['x-failure-mode'] = failureMode;
  }

  const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`[${name}] HTTP ${response.status}: ${text}`);
    // Attach status so RetryPolicy can classify it
    (err as any).httpStatus = response.status;
    throw err;
  }

  return response.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateReportResponse {
  id: string;
  idempotency_key: string;
  status: string;
  expected_image_count: number;
  created_at: string;
}

export async function createReport(params: {
  idempotencyKey: string;
  description: string;
  expectedImageCount: number;
  failureMode?: string;
}): Promise<CreateReportResponse> {
  return callFunction<CreateReportResponse>('create-report', {
    idempotency_key: params.idempotencyKey,
    description: params.description,
    expected_image_count: params.expectedImageCount,
  }, params.failureMode);
}

export interface RegisterImageResponse {
  id: string;
  client_image_id: string;
  storage_path: string;
  checksum: string;
  file_size: number;
  created_at: string;
}

export async function registerImage(params: {
  reportId: string;
  clientImageId: string;
  storagePath: string;
  checksum: string;
  fileSize: number;
  failureMode?: string;
}): Promise<RegisterImageResponse> {
  return callFunction<RegisterImageResponse>('register-image', {
    report_id: params.reportId,
    client_image_id: params.clientImageId,
    storage_path: params.storagePath,
    checksum: params.checksum,
    file_size: params.fileSize,
  }, params.failureMode);
}

export interface FinalizeReportResponse {
  id: string;
  status: string;
  updated_at: string;
  already_finalized?: boolean;
}

export async function finalizeReport(params: {
  reportId: string;
  failureMode?: string;
}): Promise<FinalizeReportResponse> {
  return callFunction<FinalizeReportResponse>('finalize-report', {
    report_id: params.reportId,
  }, params.failureMode);
}

/** Upload a binary file directly to Supabase Storage. */
export async function uploadImageToStorage(params: {
  storagePath: string;
  fileUri: string;          // file:// path on device
  fileSizeBytes: number;
  failureMode?: string;
}): Promise<void> {
  // Build the Storage upload URL manually so we can stream the file.
  const uploadUrl =
    `${ENV.SUPABASE_URL}/storage/v1/object/report-images/${params.storagePath}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`,
    'Content-Type': 'image/jpeg',
    'x-upsert': 'false', // never silently overwrite
  };
  if (params.failureMode) {
    headers['x-failure-mode'] = params.failureMode;
  }

  // Use the native fetch with a file:// URI body — React Native's fetch
  // implementation streams the file without loading it into JS memory.
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: { uri: params.fileUri, name: params.storagePath, type: 'image/jpeg' } as any,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // 409 Conflict means the file already exists in Storage.  Treat this as
    // success — the register-image step will verify the checksum.
    if (response.status === 409) return;
    const err = new Error(`[uploadImageToStorage] HTTP ${response.status}: ${text}`);
    (err as any).httpStatus = response.status;
    throw err;
  }
}

/** Fetch finalised reports for the Server Reports screen. */
export async function fetchServerReports(): Promise<ServerReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(`
      id,
      description,
      status,
      expected_image_count,
      created_at,
      report_images (
        id,
        storage_path,
        checksum,
        file_size
      )
    `)
    .eq('status', 'finalized')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    const err = new Error(`[fetchServerReports] ${error.message}`);
    (err as any).httpStatus = 500;
    throw err;
  }

  // Build signed URLs for each image so the client can display them.
  const reports = await Promise.all(
    (data ?? []).map(async (r: any) => {
      const images = await Promise.all(
        (r.report_images ?? []).map(async (img: any) => {
          const { data: signedData } = await supabase.storage
            .from('report-images')
            .createSignedUrl(img.storage_path, 3600); // 1-hour TTL
          return {
            id: img.id,
            storage_path: img.storage_path,
            checksum: img.checksum,
            file_size: img.file_size,
            public_url: signedData?.signedUrl ?? null,
          };
        }),
      );
      return {
        id: r.id,
        description: r.description,
        status: r.status,
        image_count: r.expected_image_count,
        created_at: r.created_at,
        images,
      };
    }),
  );

  return reports;
}
