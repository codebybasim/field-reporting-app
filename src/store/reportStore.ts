/**
 * reportStore
 *
 * Zustand store for UI-facing report state.
 *
 * Responsibilities:
 *  - Cache of local reports and their images for Outbox screen display.
 *  - Loading / error state for compose and refresh actions.
 *  - Refreshed after SQLite mutations (the store reads from SQLite, it
 *    doesn't own the source of truth).
 *
 * Upload logic lives in UploadCoordinator (plain TypeScript), NOT here.
 * This store never makes network calls.
 */

import { create } from 'zustand';
import {
  getAllReports,
  countLocalReports,
} from '../core/database/repositories/ReportRepository';
import { getImagesByReportId } from '../core/database/repositories/ImageRepository';
import { getJobByReportId } from '../core/database/repositories/UploadJobRepository';
import type { LocalReport, LocalReportImage, UploadJob } from '../types';

export interface ReportWithImages {
  report: LocalReport;
  images: LocalReportImage[];
  job: (UploadJob & { generation: number }) | null;
}

interface ReportStore {
  reports: ReportWithImages[];
  isLoading: boolean;
  error: string | null;
  pendingCount: number;

  /** Re-read all reports from SQLite into the store */
  refresh: () => void;
  setError: (msg: string | null) => void;
}

export const useReportStore = create<ReportStore>((set) => ({
  reports: [],
  isLoading: false,
  error: null,
  pendingCount: 0,

  refresh: () => {
    try {
      const rawReports = getAllReports();
      const reports: ReportWithImages[] = rawReports.map(report => ({
        report,
        images: getImagesByReportId(report.id),
        job: getJobByReportId(report.id),
      }));
      const pendingCount = countLocalReports();
      set({ reports, pendingCount, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load reports' });
    }
  },

  setError: (msg) => set({ error: msg }),
}));
