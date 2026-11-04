/**
 * Shared failure-simulator helper.
 *
 * Failure mode is driven exclusively by the per-request `x-failure-mode`
 * header.  Deno KV is NOT used — it is unavailable on Supabase Edge Runtime.
 *
 * Each Edge Function calls `applyFailureSimulator(req)` at the top of its
 * handler.  If a non-null Response is returned, the function should return it
 * immediately without doing any real work.
 */

export type FailureMode = 'none' | 'slow' | 'drop' | 'error' | 'reject' | 'hang';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-failure-mode',
};

function getMode(req: Request): FailureMode {
  const h = req.headers.get('x-failure-mode') as FailureMode | null;
  if (h && ['none', 'slow', 'drop', 'error', 'reject', 'hang'].includes(h)) return h;
  return 'none';
}

/** Returns additional response headers (no-op in this implementation). */
export function simulatorHeaders(): Record<string, string> {
  return {};
}

/**
 * Call at the START of a handler.
 * Returns a Response to short-circuit, or null to continue normally.
 */
export async function applyFailureSimulator(req: Request): Promise<Response | null> {
  const mode = getMode(req);

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
      await new Promise(resolve => setTimeout(resolve, 3000));
      return null;

    case 'hang':
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
 * In `drop` mode returns an empty body simulating a dropped connection.
 */
export async function maybeDropResponse(
  req: Request,
  realResponse: Response,
): Promise<Response> {
  const mode = getMode(req);
  if (mode === 'drop') {
    return new Response(null, {
      status: 200,
      headers: { ...corsHeaders, 'x-sim-mode': 'drop', 'Content-Length': '0' },
    });
  }
  return realResponse;
}
