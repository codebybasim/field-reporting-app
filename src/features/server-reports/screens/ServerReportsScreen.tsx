/**
 * ServerReportsScreen
 *
 * Fetches and displays finalized reports directly from Supabase.
 * Data source: network only — never SQLite, never Zustand local state.
 * This screen proves what actually reached the backend.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadServerReports } from '../services/ServerReportsService';
import type { ServerReport, ServerImage } from '../../../types';

export function ServerReportsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReports = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await loadServerReports();
      setReports(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load server reports');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchReports(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading server reports…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Could not load reports</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => fetchReports(false)}
          accessibilityRole="button">
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={reports}
      keyExtractor={item => item.id}
      contentContainerStyle={[
        reports.length === 0 ? styles.emptyContainer : styles.listContent,
        { paddingBottom: insets.bottom + 16 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchReports(true)}
          tintColor="#2563EB"
        />
      }
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <Text style={styles.listHeaderText}>
            {reports.length} delivered report{reports.length !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.listHeaderSub}>Pull down to refresh</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>☁️</Text>
          <Text style={styles.emptyTitle}>No delivered reports</Text>
          <Text style={styles.emptySubtitle}>
            Reports appear here once they have been delivered to and confirmed by the server.
          </Text>
        </View>
      }
      renderItem={({ item }) => <ServerReportCard report={item} />}
    />
  );
}

function ServerReportCard({ report }: { report: ServerReport }): React.JSX.Element {
  const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const createdTime = new Date(report.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={styles.card}>
      {/* Server ID */}
      <View style={styles.serverIdRow}>
        <Text style={styles.serverIdLabel}>Server ID</Text>
        <Text style={styles.serverId} numberOfLines={1} ellipsizeMode="middle">
          {report.id}
        </Text>
      </View>

      {/* Timestamp */}
      <Text style={styles.cardDate}>{createdDate} at {createdTime}</Text>

      {/* Status chip */}
      <View style={styles.statusChip}>
        <Text style={styles.statusChipText}>✓ {report.status}</Text>
      </View>

      {/* Description */}
      <Text style={styles.cardDescription}>{report.description}</Text>

      {/* Image count */}
      <Text style={styles.imageCount}>
        📷 {report.images.length} image{report.images.length !== 1 ? 's' : ''}
      </Text>

      {/* Image thumbnails */}
      {report.images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.imageStrip}>
          {report.images.map(img => (
            <ServerImageThumb key={img.id} image={img} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ServerImageThumb({ image }: { image: ServerImage }): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  if (!image.public_url || failed) {
    return (
      <View style={[styles.thumb, styles.thumbPlaceholder]}>
        <Text style={styles.thumbPlaceholderText}>🖼</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: image.public_url }}
      style={styles.thumb}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityLabel="Report photo"
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 14 },
  errorIcon: { fontSize: 40 },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  errorMsg: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 8, marginTop: 8,
  },
  retryBtnText: { color: '#FFFFFF', fontWeight: '600' },
  listContent: { padding: 12, gap: 10 },
  emptyContainer: { flex: 1 },
  listHeader: { marginBottom: 8 },
  listHeaderText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  listHeaderSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, gap: 8,
    elevation: 1, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2,
  },
  serverIdRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serverIdLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  serverId: { flex: 1, fontSize: 11, color: '#374151', fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier New' },
  cardDate: { fontSize: 12, color: '#9CA3AF' },
  statusChip: {
    alignSelf: 'flex-start', backgroundColor: '#D1FAE5',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  statusChipText: { fontSize: 11, fontWeight: '600', color: '#065F46' },
  cardDescription: { fontSize: 14, color: '#374151', lineHeight: 20 },
  imageCount: { fontSize: 12, color: '#6B7280' },
  imageStrip: { marginTop: 4 },
  thumb: {
    width: 80, height: 80, borderRadius: 6, marginRight: 8,
    backgroundColor: '#E5E7EB',
  },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholderText: { fontSize: 24 },
});

// Needed for Platform reference inside styles
import { Platform } from 'react-native';
