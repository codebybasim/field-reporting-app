/**
 * failure-simulator Edge Function
 *
 * DEV ONLY.  Sets or clears the active failure mode in a Deno KV store so all
 * other Edge Functions can check it via the shared helper.
 *
 * POST /functions/v1/failure-simulator
 * Body: { mode: "none" | "slow" | "drop" | "error" | "reject" | "hang" }
 *
 * Modes:
 *   none   – normal operation
 *   slow   – adds a 3-second delay before the real response
 *   drop   – commits the operation then drops the TCP connection (simulates
 *             "server received but client never got the response")
 *   error  – returns HTTP 500 without performing any work
 *   reject – returns HTTP 400 (permanent client error)
 *   hang   – delays for 25 seconds (near Edge Function timeout) then 504s
 *
 * Example curl:
 *   curl -X POST https://<ref>.supabase.co/functions/v1/failure-simulator \
 *     -H "Authorization: Bearer <anon-key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"mode":"drop"}'
 *
 * To disable:
 *   curl ... -d '{"mode":"none"}'
 *
 * IMPORTANT: This function must be disabled in production by removing its
 * deployment or gating it behind a secret header.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_MODES = ['none', 'slow', 'drop', 'error', 'reject', 'hang'] as const;
type FailureMode = typeof VALID_MODES[number];

// We store the active mode in Deno KV (persistent across function invocations).
const kv = await Deno.openKv();
const MODE_KEY = ['failure_simulator', 'mode'];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Guard: only allow in non-production environments.
  // Set ENABLE_FAILURE_SIMULATOR=true in your Supabase project secrets for dev.
  const enabled = Deno.env.get('ENABLE_FAILURE_SIMULATOR') === 'true';
  if (!enabled) {
    return new Response(
      JSON.stringify({ error: 'Failure simulator is disabled in this environment.' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (req.method === 'GET') {
    const entry = await kv.get<FailureMode>(MODE_KEY);
    return new Response(
      JSON.stringify({ mode: entry.value ?? 'none' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const { mode } = await req.json();
  if (!VALID_MODES.includes(mode)) {
    return new Response(
      JSON.stringify({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  await kv.set(MODE_KEY, mode);

  return new Response(
    JSON.stringify({ mode, message: `Failure simulator set to '${mode}'` }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
