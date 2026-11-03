/**
 * ServerReportsService
 *
 * Fetches finalized reports directly from Supabase.
 * Never reads from SQLite — this is proof of what actually reached the backend.
 */
import { fetchServerReports } from '../../../services/api/ReportApiService';
import type { ServerReport } from '../../../types';

export async function loadServerReports(): Promise<ServerReport[]> {
  return fetchServerReports();
}
