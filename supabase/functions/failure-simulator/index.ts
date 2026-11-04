/**
 * failure-simulator Edge Function  — DEV ONLY
 *
 * Sets the active failure mode via the x-failure-mode header on subsequent
 * requests.  Since Deno KV is unavailable on Supabase Edge Runtime, this
 * function now acts as documentation / a test endpoint only.  The actual
 * failure mode is driven by the per-request x-failure-mode header.
 *
 * POST body: { mode: "none" | "slow" | "drop" | "error" | "reject" | "hang" }
 *
 * To trigger a failure on any function, add the header:
 *   x-failure-mode: error
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_MODES = ['none', 'slow', 'drop', 'error', 'reject', 'hang'] as const;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const enabled = Deno.env.get('ENABLE_FAILURE_SIMULATOR') === 'true';
  if (!enabled) {
    return new Response(
      JSON.stringify({ error: 'Failure simulator is disabled in this environment.' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        mode: 'none',
        note: 'Pass x-failure-mode header on individual requests to simulate failures.',
        valid_modes: VALID_MODES,
      }),
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

  return new Response(
    JSON.stringify({
      mode,
      message: `To simulate '${mode}', add header 'x-failure-mode: ${mode}' to your requests.`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
