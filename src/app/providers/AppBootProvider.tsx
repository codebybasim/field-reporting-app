/**
 * AppBootProvider
 *
 * Wraps the app and runs one-time startup tasks:
 *   1. Startup reconciliation (fix stuck state from previous session).
 *   2. Start connectivity listener (triggers uploads when network restores).
 *   3. Dispatch immediate upload if online and work is pending.
 *
 * Renders children immediately — reconciliation runs asynchronously in the
 * background so the UI doesn't block on it.
 */

import React, { useEffect } from 'react';
import { runStartupReconciliation } from '../../features/uploads/StartupReconciler';
import {
  start as startConnectivityDispatcher,
  stop as stopConnectivityDispatcher,
  triggerIfConnected,
} from '../../features/uploads/ConnectivityDispatcher';
import { useReportStore } from '../../store/reportStore';

interface Props {
  children: React.ReactNode;
}

export function AppBootProvider({ children }: Props): React.JSX.Element {
  const refresh = useReportStore(s => s.refresh);

  useEffect(() => {
    // Run startup work asynchronously — don't block render
    (async () => {
      try {
        await runStartupReconciliation();
        refresh(); // update Outbox after reconciliation may have changed statuses
      } catch (e) {
        console.warn('[AppBootProvider] Startup reconciliation error:', e);
      }

      try {
        startConnectivityDispatcher();
        await triggerIfConnected();
      } catch (e) {
        console.warn('[AppBootProvider] Connectivity dispatcher error:', e);
      }
    })();

    return () => {
      stopConnectivityDispatcher();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
