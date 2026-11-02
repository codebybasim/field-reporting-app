/**
 * NetworkMonitor
 *
 * Wraps @react-native-community/netinfo.
 * Provides a simple observable "is connected" state that the UploadCoordinator
 * can subscribe to without touching React components.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

type ConnectivityListener = (isConnected: boolean) => void;

let _isConnected = false;
const _listeners = new Set<ConnectivityListener>();

let _unsubscribe: (() => void) | null = null;

export function startMonitoring(): void {
  if (_unsubscribe) return; // already running

  _unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const connected = !!(state.isConnected && state.isInternetReachable !== false);
    if (connected !== _isConnected) {
      _isConnected = connected;
      _listeners.forEach(l => l(connected));
    }
  });
}

export function stopMonitoring(): void {
  _unsubscribe?.();
  _unsubscribe = null;
}

export function isConnected(): boolean {
  return _isConnected;
}

export function addConnectivityListener(listener: ConnectivityListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  _isConnected = !!(state.isConnected && state.isInternetReachable !== false);
  return _isConnected;
}
