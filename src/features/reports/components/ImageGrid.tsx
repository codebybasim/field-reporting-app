/**
 * ImageGrid
 *
 * Displays up to 5 image previews in a responsive grid.
 * Each cell shows a thumbnail with an optional remove button and a
 * processing indicator overlay.
 */
import React from 'react';
import {
  View,
  Image,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';

export interface ImageItem {
  id: string;
  uri: string;          // file:// or content:// URI for the preview
  processing?: boolean; // show spinner overlay while compressing
}

interface Props {
  images: ImageItem[];
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}

const COLUMNS = 3;
const GAP = 8;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CELL_SIZE = (SCREEN_WIDTH - 32 - GAP * (COLUMNS - 1)) / COLUMNS;

export function ImageGrid({ images, onRemove, readOnly = false }: Props): React.JSX.Element {
  return (
    <View style={styles.grid}>
      {images.map(item => (
        <View key={item.id} style={styles.cell}>
          <Image
            source={{ uri: item.uri }}
            style={styles.thumb}
            resizeMode="cover"
            accessibilityLabel="Selected photo"
          />
          {item.processing && (
            <View style={styles.overlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
          {!readOnly && !item.processing && onRemove && (
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(item.id)}
              accessibilityLabel="Remove photo"
              accessibilityRole="button">
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
});
