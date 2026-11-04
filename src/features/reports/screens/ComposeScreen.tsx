/**
 * ComposeScreen
 *
 * Allows the field inspector to:
 *   - Write a description
 *   - Attach 1–5 photos (camera or gallery)
 *   - See image processing progress
 *   - Submit / save the report
 *
 * Upload is NOT triggered from here — ComposeScreen saves to SQLite and
 * the BackgroundScheduler handles delivery.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';

import { ImageGrid, type ImageItem } from '../components/ImageGrid';
import {
  requestCameraPermission,
  requestGalleryPermission,
  showPermissionBlockedAlert,
} from '../../../core/permissions/PermissionsService';
import { composeAndSaveReport } from '../services/ReportComposerService';
import { useReportStore } from '../../../store/reportStore';
import { generateUUID } from '../../../utils/uuid';

const MAX_IMAGES = 5;

type ImageEntry = ImageItem & {
  rawUri: string;
};

export function ComposeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const refresh = useReportStore(s => s.refresh);

  const [description, setDescription] = useState('');
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const descriptionRef = useRef<React.ElementRef<typeof TextInput>>(null);

  // ── Image actions ────────────────────────────────────────────────────────

  const addImages = useCallback((assets: Asset[]) => {
    const slots = MAX_IMAGES - images.length;
    const toAdd = assets.slice(0, slots).map((a): ImageEntry => ({
      id: generateUUID(),
      uri: a.uri ?? '',
      rawUri: a.uri ?? '',
      processing: false,
    }));
    setImages(prev => [...prev, ...toAdd]);
  }, [images.length]);

  const handleCamera = useCallback(async () => {
    const perm = await requestCameraPermission();
    if (perm === 'blocked') { showPermissionBlockedAlert('camera'); return; }
    if (perm === 'denied') return;

    const result = await launchCamera({
      mediaType: 'photo',
      quality: 1,
      saveToPhotos: false,
    });
    if (result.assets?.length) addImages(result.assets);
  }, [addImages]);

  const handleGallery = useCallback(async () => {
    const perm = await requestGalleryPermission();
    if (perm === 'blocked') { showPermissionBlockedAlert('gallery'); return; }
    if (perm === 'denied') return;

    const remaining = MAX_IMAGES - images.length;
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 1,
      selectionLimit: remaining,
    });
    if (result.assets?.length) addImages(result.assets);
  }, [images.length, addImages]);

  const handleRemove = useCallback((id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!description.trim()) {
      setSubmitError('Please enter a description before saving.');
      return;
    }
    if (images.length === 0) {
      setSubmitError('Please add at least one photo.');
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    setProgressMsg('Starting…');

    try {
      await composeAndSaveReport({
        description,
        imageUris: images.map(i => i.rawUri),
        onProgress: msg => setProgressMsg(msg),
      });

      // Reset form
      setDescription('');
      setImages([]);
      setProgressMsg(null);
      refresh();

      Alert.alert(
        'Report Saved',
        'Your report has been saved and will be delivered automatically when online.',
        [{ text: 'OK' }],
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save report');
      setProgressMsg(null);
    } finally {
      setSubmitting(false);
    }
  }, [description, images, refresh]);

  const canAddMore = images.length < MAX_IMAGES;
  const isValid = description.trim().length > 0 && images.length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled">

        {/* Description */}
        <Text style={styles.label}>Description *</Text>
        <TextInput
          ref={descriptionRef}
          style={styles.textInput}
          value={description}
          onChangeText={text => { setDescription(text); setSubmitError(null); }}
          placeholder="Describe what you observed…"
          placeholderTextColor="#9CA3AF"
          multiline
          numberOfLines={4}
          maxLength={2000}
          editable={!submitting}
          accessibilityLabel="Report description"
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{description.length} / 2000</Text>

        {/* Photos */}
        <View style={styles.photoHeader}>
          <Text style={styles.label}>Photos *</Text>
          <Text style={styles.photoCount}>{images.length} / {MAX_IMAGES}</Text>
        </View>

        {images.length > 0 && (
          <ImageGrid
            images={images}
            onRemove={submitting ? undefined : handleRemove}
            readOnly={submitting}
          />
        )}

        {canAddMore && !submitting && (
          <View style={styles.photoActions}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={handleCamera}
              accessibilityRole="button"
              accessibilityLabel="Take a photo with camera">
              <MaterialCommunityIcons name="camera-outline" size={26} color="#374151" />
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={handleGallery}
              accessibilityRole="button"
              accessibilityLabel="Choose from gallery">
              <MaterialCommunityIcons name="image-outline" size={26} color="#374151" />
              <Text style={styles.photoBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Validation error */}
        {submitError != null && (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}

        {/* Progress */}
        {submitting && progressMsg != null && (
          <View style={styles.progressRow}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.progressText}>{progressMsg}</Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!isValid || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isValid || submitting}
          accessibilityRole="button"
          accessibilityLabel="Save and queue report for upload"
          accessibilityState={{ disabled: !isValid || submitting }}>
          {submitting
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.submitText}>Save Report</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 4 },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#111827',
    minHeight: 100,
  },
  charCount: { fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 2 },
  photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photoCount: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  photoActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  photoBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  photoBtnText: { fontSize: 14, fontWeight: '500', color: '#374151' },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#B91C1C', fontSize: 14 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { color: '#2563EB', fontSize: 14 },
  submitBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: '#93C5FD' },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
