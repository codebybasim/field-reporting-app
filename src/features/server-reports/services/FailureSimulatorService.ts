/**
 * FailureSimulatorService
 *
 * DEV ONLY. Calls the failure-simulator Edge Function to set/get the active
 * failure mode on the Supabase backend.
 *
 * Modes:
 *   none   – normal operation
 *   slow   – 3-second delay before real response
 *   drop   – commits operation, drops TCP connection (lost-response scenario)
 *   error  – HTTP 500 without doing any work
 *   reject – HTTP 400 (permanent client error)
 *   hang   – 25-second delay then 504
 */
import { ENV } from '../../../utils/env';

export type FailureMode = 'none' | 'slow' | 'drop' | 'error' | 'reject' | 'hang';

const FUNCTION_URL = `${ENV.SUPABASE_URL}/functions/v1/failure-simulator`;

async function callSimulator(method: 'GET' | 'POST', body?: object): Promise<any> {
  const res = await fetch(FUNCTION_URL, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failure simulator HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getFailureMode(): Promise<FailureMode> {
  const data = await callSimulator('GET');
  return (data.mode ?? 'none') as FailureMode;
}

export async function setFailureMode(mode: FailureMode): Promise<void> {
  await callSimulator('POST', { mode });
}
