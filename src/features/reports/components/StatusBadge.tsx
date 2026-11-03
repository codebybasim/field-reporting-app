/**
 * StatusBadge — coloured pill showing a report's delivery status.
 * Uses explicit text labels so status is never ambiguous.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ReportStatus } from '../../../types';

interface Props {
  status: ReportStatus;
}

const CONFIG: Record<ReportStatus, { label: string; bg: string; text: string }> = {
  draft:     { label: 'Draft',           bg: '#F3F4F6', text: '#374151' },
  pending:   { label: 'Waiting',         bg: '#FEF3C7', text: '#92400E' },
  uploading: { label: 'Uploading…',      bg: '#DBEAFE', text: '#1E40AF' },
  uploaded:  { label: 'Delivered ✓',     bg: '#D1FAE5', text: '#065F46' },
  failed:    { label: 'Needs attention', bg: '#FEE2E2', text: '#991B1B' },
};

export function StatusBadge({ status }: Props): React.JSX.Element {
  const cfg = CONFIG[status] ?? CONFIG.pending;
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.label, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
