/**
 * Deterministic UUID v4 generation.
 * React Native's `crypto.randomUUID()` is available on RN 0.73+ with the
 * Hermes engine.  We fall back to a manual implementation for safety.
 */
export function generateUUID(): string {
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).crypto !== 'undefined' &&
    typeof (globalThis as any).crypto.randomUUID === 'function'
  ) {
    return (globalThis as any).crypto.randomUUID() as string;
  }
  // Fallback: RFC 4122 v4 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
