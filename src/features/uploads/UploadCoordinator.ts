/**
 * UploadCoordinator
 *
 * Singleton service responsible for durable report delivery.
 *
 * This is a plain TypeScript class with no React dependencies.
 * It can be instantiated and tested independently of any component.
 *
 * Full implementation arrives in Milestone 3 (Day 2 — Delivery).
 * This stub exists so:
 *   - HeadlessUploadTaskService can import it without errors
 *   - BackgroundScheduler wiring is fully testable today
 *   - TypeScript compilation succeeds end-to-end
 *
 * The stub processQueue() logs a message and resolves immediately.
 * Replace the body with the real implementation in the next milestone.
 */

export class UploadCoordinator {
  private static _instance: UploadCoordinator | null = null;

  /** Singleton accessor — safe to call from headless context */
  static getInstance(): UploadCoordinator {
    if (!UploadCoordinator._instance) {
      UploadCoordinator._instance = new UploadCoordinator();
    }
    return UploadCoordinator._instance;
  }

  private constructor() {}

  /**
   * Process the upload queue.
   *
   * STUB: Full implementation in Milestone 3.
   * Returns immediately; all retry/idempotency logic lives here in the real version.
   */
  async processQueue(): Promise<void> {
    console.log('[UploadCoordinator] processQueue called (stub — real logic in Milestone 3)');
  }

  /**
   * Called by the Reset feature to stop in-flight work and invalidate the queue.
   */
  async reset(): Promise<void> {
    console.log('[UploadCoordinator] reset called (stub)');
  }
}
