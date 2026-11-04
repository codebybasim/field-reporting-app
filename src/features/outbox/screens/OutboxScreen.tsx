/**
 * OutboxScreen — Delivery Queue
 *
 * Shows all local reports and their delivery status.
 * Never uses "Saved" and "Uploaded" interchangeably.
 *
 * Status meaning shown to the user:
 *   draft      → Saved on device
 *   pending    → Waiting for network
 *   uploading  → Uploading…
 *   uploaded   → Delivered to server ✓
 *   failed     → Needs attention (with last error)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReportStore, type ReportWithImages } from '../../../store/reportStore';
import { StatusBadge } from '../../reports/components/StatusBadge';
import { executeReset } from '../../uploads/ResetService';
import { scheduleUpload } from '../../uploads/BackgroundScheduler';
import {
  resetFailedJobs,
} from '../../../core/database/repositories/UploadJobRepository';
import {
  updateReportStatus,
  getAllReports,
} from '../../../core/database/repositories/ReportRepository';

export function OutboxScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { reports, pendingCount, refresh, isLoading } = useReportStore();
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      // Reset all failed jobs back to pending so the coordinator picks them up
      resetFailedJobs();
      // Also reset the report status so they show as pending in the UI
      const allReports = getAllReports();
      for (const r of allReports) {
        if (r.status === 'failed') {
          updateReportStatus(r.id, 'pending');
        }
      }
      refresh();
      await scheduleUpload();
      Alert.alert('Retry Queued', 'Failed reports have been reset and upload re-scheduled.');
    } catch {
      Alert.alert('Error', 'Could not schedule retry.');
    }
  }, [refresh]);

  const handleReset = useCallback(() => {
    const localCount = reports.filter(r => r.report.status !== 'uploaded').length;

    Alert.alert(
      'Reset Local Data',
      `This will permanently delete ${localCount} unsent report${localCount !== 1 ? 's' : ''} from this device.\n\n` +
      'Reports already delivered to the server will remain untouched.\n\n' +
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Local Reports',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await executeReset(localCount);
              refresh();
              Alert.alert('Reset Complete', 'Local reports have been deleted. Server reports are intact.');
            } catch (e) {
              Alert.alert('Reset Error', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  }, [reports, refresh]);

  const hasFailed = reports.some(r => r.report.status === 'failed');
  const hasPending = reports.some(
    r => r.report.status === 'pending' || r.report.status === 'uploading',
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header stats bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {reports.length} report{reports.length !== 1 ? 's' : ''} on device
          {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
        </Text>
        <View style={styles.headerActions}>
          {hasFailed && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry failed uploads">
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={handleReset}
            disabled={resetting}
            accessibilityRole="button"
            accessibilityLabel="Reset local data">
            {resetting
              ? <ActivityIndicator size="small" color="#DC2626" />
              : <Text style={styles.resetBtnText}>Reset</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={reports}
        keyExtractor={item => item.report.id}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            tintColor="#2563EB"
          />
        }
        contentContainerStyle={reports.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptySubtitle}>
              Compose a report on the first tab to get started.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ReportCard item={item} />}
      />

      {hasPending && (
        <View style={styles.uploadingBanner}>
          <ActivityIndicator size="small" color="#1E40AF" />
          <Text style={styles.uploadingText}>Delivering reports…</Text>
        </View>
      )}
    </View>
  );
}

function ReportCard({ item }: { item: ReportWithImages }): React.JSX.Element {
  const { report, images, job } = item;
  const uploadedCount = images.filter(i => i.uploadStatus === 'uploaded').length;

  const createdDate = new Date(report.createdAt).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const createdTime = new Date(report.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={styles.card}>
      {/* Status + date */}
      <View style={styles.cardHeader}>
        <StatusBadge status={report.status} />
        <Text style={styles.cardDate}>{createdDate} {createdTime}</Text>
      </View>

      {/* Description */}
      <Text style={styles.cardDescription} numberOfLines={3}>
        {report.description}
      </Text>

      {/* Image progress */}
      <View style={styles.progressRow}>
        <Text style={styles.progressLabel}>
          📷 {uploadedCount} / {images.length} image{images.length !== 1 ? 's' : ''} delivered
        </Text>
        {images.length > 0 && (
          <ProgressBar value={uploadedCount / images.length} />
        )}
      </View>

      {/* Last error */}
      {report.status === 'failed' && job?.lastError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} numberOfLines={2}>
            ⚠️ {job.lastError}
          </Text>
        </View>
      )}

      {/* Next retry */}
      {report.status === 'pending' && job?.nextAttemptAt && (
        <Text style={styles.retryInfo}>
          🕐 Retry at {new Date(job.nextAttemptAt).toLocaleTimeString()}
        </Text>
      )}

      {/* Attempts */}
      {job && job.attempts > 0 && report.status !== 'uploaded' && (
        <Text style={styles.attemptCount}>
          {job.attempts} attempt{job.attempts !== 1 ? 's' : ''}
        </Text>
      )}
    </View>
  );
}

function ProgressBar({ value }: { value: number }): React.JSX.Element {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.min(value * 100, 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  statsText: { fontSize: 13, color: '#6B7280', flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  retryBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, backgroundColor: '#EFF6FF',
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: '#2563EB' },
  resetBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, backgroundColor: '#FEF2F2',
    borderWidth: 1, borderColor: '#FECACA',
  },
  resetBtnText: { fontSize: 13, fontWeight: '600', color: '#DC2626' },
  listContent: { padding: 12, gap: 10 },
  emptyContainer: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  uploadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#BFDBFE',
  },
  uploadingText: { color: '#1E40AF', fontSize: 13, fontWeight: '500' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 12, color: '#9CA3AF' },
  cardDescription: { fontSize: 14, color: '#374151', lineHeight: 20 },
  progressRow: { gap: 4 },
  progressLabel: { fontSize: 12, color: '#6B7280' },
  barTrack: {
    height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 2 },
  errorBox: {
    backgroundColor: '#FEF2F2', borderRadius: 6, padding: 8,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorText: { fontSize: 12, color: '#B91C1C', lineHeight: 16 },
  retryInfo: { fontSize: 12, color: '#92400E' },
  attemptCount: { fontSize: 11, color: '#9CA3AF' },
});
