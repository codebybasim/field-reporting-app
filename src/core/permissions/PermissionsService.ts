/**
 * PermissionsService
 *
 * Centralises camera and gallery permission requests.
 * On Android 13+ READ_MEDIA_IMAGES replaces READ_EXTERNAL_STORAGE.
 */
import { Platform, PermissionsAndroid, Linking, Alert } from 'react-native';

export type PermissionResult = 'granted' | 'denied' | 'blocked';

export async function requestCameraPermission(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Camera Permission',
      message: 'FieldReport needs access to your camera to photograph your report.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return mapResult(result);
}

export async function requestGalleryPermission(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  // Android 13+ uses READ_MEDIA_IMAGES; earlier versions use READ_EXTERNAL_STORAGE.
  const apiLevel = parseInt(String(Platform.Version), 10);
  const permission =
    apiLevel >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

  const result = await PermissionsAndroid.request(permission, {
    title: 'Gallery Permission',
    message: 'FieldReport needs access to your photo gallery.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });
  return mapResult(result);
}

export function showPermissionBlockedAlert(type: 'camera' | 'gallery'): void {
  Alert.alert(
    `${type === 'camera' ? 'Camera' : 'Gallery'} Permission Required`,
    `FieldReport doesn't have ${type} access. Please open Settings and grant the permission.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}

function mapResult(result: string): PermissionResult {
  switch (result) {
    case PermissionsAndroid.RESULTS.GRANTED:
      return 'granted';
    case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
      return 'blocked';
    default:
      return 'denied';
  }
}
