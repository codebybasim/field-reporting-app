/**
 * Shared failure-simulator helper.
 *
 * Each Edge Function calls `applyFailureSimulator(req)` at the top of its
 * handler.  If a non-null Response is returned, the function should return it
 * immediately without doing any real work.
 *
 * The `drop` mode is special: the caller must perform its real work first, then
 * call `maybeDropAfterCommit()` instead of returning the real response.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type FailureMode = 'none' | 'slow' | 'drop' | 'error' | 'reject' | 'hang';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-failure-mode',
};

/** Returns additional response headers that expose the active sim mode (handy for debugging). */
export function simulatorHeaders(): Record<string, string> {
  return {};  // populated in real responses only when simulator is active
}

async function getMode(req: Request): Promise<FailureMode> {
  // Allow per-request override via header (useful for targeted tests).
  const headerMode = req.headers.get('x-failure-mode') as FailureMode | null;
  if (headerMode) return headerMode;

  const enabled = Deno.env.get('ENABLE_FAILURE_SIMULATOR') === 'true';
  if (!enabled) return 'none';

  try {
    const kv = await Deno.openKv();
    const entry = await kv.get<FailureMode>(['failure_simulator', 'mode']);
    return entry.value ?? 'none';
  } catch {
    return 'none';
  }
}

/**
 * Call at the START of a handler (before doing real work).
 * Returns a Response to short-circuit, or null to continue normally.
 * `drop` mode returns null here so the real work can proceed — use
 * `maybeDropResponse` after committing.
 */
export async function applyFailureSimulator(req: Request): Promise<Response | null> {
  const mode = await getMode(req);

  switch (mode) {
    case 'error':
      return new Response(JSON.stringify({ error: 'Simulated server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-sim-mode': mode },
      });

    case 'reject':
      return new Response(JSON.stringify({ error: 'Simulated permanent rejection' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-sim-mode': mode },
      });

    case 'slow':
      // Delay by 3 seconds then let the real handler proceed.
      await new Promise(resolve => setTimeout(resolve, 3000));
      return null;

    case 'hang':
      // Delay 25 s then return a timeout error (just under Supabase's 30 s limit).
      await new Promise(resolve => setTimeout(resolve, 25000));
      return new Response(JSON.stringify({ error: 'Simulated gateway timeout' }), {
        status: 504,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-sim-mode': mode },
      });

    case 'drop':
    case 'none':
    default:
      return null;
  }
}

/**
 * Call AFTER committing real work.
 * In `drop` mode this closes the connection without sending a response,
 * simulating "server committed but client never received the reply".
 * In all other modes it returns the realResponse unchanged.
 */
export async function maybeDropResponse(
  req: Request,
  realResponse: Response,
): Promise<Response> {
  const mode = await getMode(req);
  if (mode === 'drop') {
    // We cannot literally close a TCP connection from a Deno edge function,
    // but we can return an empty body with a 0-length content, which causes
    // most HTTP clients to treat the response as incomplete/dropped.
    return new Response(null, {
      status: 200,
      headers: { ...corsHeaders, 'x-sim-mode': 'drop', 'Content-Length': '0' },
    });
  }
  return realResponse;
}
