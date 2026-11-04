/**
 * FailureSimulatorScreen — DEV ONLY
 *
 * Accessed by tapping the header title 5 times on the Server Reports screen.
 * Lets the developer set the active backend failure mode for testing.
 *
 * Only functional when ENABLE_FAILURE_SIMULATOR=true in Supabase project
 * secrets AND in the local .env.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getFailureMode,
  setFailureMode,
  type FailureMode,
} from '../services/FailureSimulatorService';

const MODES: { mode: FailureMode; label: string; description: string; color: string }[] = [
  {
    mode: 'none',
    label: 'None (normal)',
    description: 'All requests succeed normally.',
    color: '#065F46',
  },
  {
    mode: 'slow',
    label: 'Slow (3 s delay)',
    description: 'Adds a 3-second delay before every response. Tests timeout handling.',
    color: '#92400E',
  },
  {
    mode: 'drop',
    label: 'Drop (commit + no response)',
    description:
      'Commits the operation server-side then drops the connection. ' +
      'Tests lost-response / idempotent retry scenario.',
    color: '#1E40AF',
  },
  {
    mode: 'error',
    label: 'Error (HTTP 500)',
    description: 'Returns 500 without doing any work. Tests retryable error path.',
    color: '#7C3AED',
  },
  {
    mode: 'reject',
    label: 'Reject (HTTP 400)',
    description: 'Returns 400 permanent error. Tests non-retryable failure path.',
    color: '#B91C1C',
  },
  {
    mode: 'hang',
    label: 'Hang (25 s then 504)',
    description:
      'Delays 25 seconds then returns 504. Tests gateway timeout handling. ' +
      'Edge Function will self-terminate near its 30 s limit.',
    color: '#374151',
  },
];

interface Props {
  onClose: () => void;
}

export function FailureSimulatorScreen({ onClose }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [currentMode, setCurrentMode] = useState<FailureMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mode = await getFailureMode();
      setCurrentMode(mode);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to load mode. Is ENABLE_FAILURE_SIMULATOR=true in Supabase secrets?',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMode();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSet = useCallback(async (mode: FailureMode) => {
    setSetting(true);
    setError(null);
    try {
      await setFailureMode(mode);
      setCurrentMode(mode);
      if (mode === 'none') {
        Alert.alert('Simulator Off', 'Backend is now operating normally.');
      } else {
        Alert.alert('Mode Set', `Backend failure mode set to "${mode}".`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set mode');
    } finally {
      setSetting(false);
    }
  }, []);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>⚠️ Failure Simulator</Text>
          <Text style={styles.headerSub}>DEV ONLY — not visible in production</Text>
        </View>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close simulator">
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.loadingText}>Loading current mode…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>
            Current mode:{' '}
            <Text style={styles.sectionValue}>{currentMode ?? '…'}</Text>
          </Text>

          {MODES.map(({ mode, label, description, color }) => {
            const isActive = currentMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modeCard,
                  isActive && { borderColor: color, borderWidth: 2 },
                ]}
                onPress={() => handleSet(mode)}
                disabled={setting || isActive}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}>
                <View style={styles.modeRow}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={[styles.modeLabel, { color }]}>{label}</Text>
                  {isActive && (
                    <View style={[styles.activeBadge, { backgroundColor: color }]}>
                      <Text style={styles.activeBadgeText}>ACTIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.modeDesc}>{description}</Text>
              </TouchableOpacity>
            );
          })}

          {setting && (
            <View style={styles.settingRow}>
              <ActivityIndicator size="small" color="#2563EB" />
              <Text style={styles.settingText}>Applying…</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    padding: 16,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F9FAFB' },
  headerSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  closeBtn: { padding: 8 },
  closeBtnText: { color: '#F9FAFB', fontSize: 18 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 14 },
  list: { padding: 16, gap: 10 },
  errorBox: {
    backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorText: { color: '#B91C1C', fontSize: 13 },
  sectionLabel: { fontSize: 13, color: '#6B7280', marginBottom: 4 },
  sectionValue: { fontWeight: '700', color: '#111827' },
  modeCard: {
    backgroundColor: '#FFFFFF', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#E5E7EB', gap: 6,
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  modeLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
  activeBadge: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
  },
  activeBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  modeDesc: { fontSize: 12, color: '#6B7280', lineHeight: 17 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  settingText: { color: '#2563EB', fontSize: 14 },
});
