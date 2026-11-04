/**
 * finalize-report Edge Function
 *
 * Verifies all expected images have been registered, then marks the report as
 * 'finalized'.  Idempotent: calling this on an already-finalized report is
 * safe and returns the current state.
 *
 * POST /functions/v1/finalize-report
 * Body: { report_id: string }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyFailureSimulator } from '../_shared/failure-simulator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-failure-mode',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const simResponse = await applyFailureSimulator(req);
  if (simResponse) return simResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { report_id } = await req.json();

    if (!report_id) {
      return new Response(
        JSON.stringify({ error: 'report_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Fetch report ──────────────────────────────────────────────────────
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, expected_image_count, status')
      .eq('id', report_id)
      .single();

    if (reportError || !report) {
      return new Response(
        JSON.stringify({ error: 'Report not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Already finalized — idempotent response
    if (report.status === 'finalized') {
      return new Response(
        JSON.stringify({ id: report.id, status: 'finalized', already_finalized: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Count registered images ───────────────────────────────────────────
    const { count, error: countError } = await supabase
      .from('report_images')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', report_id);

    if (countError) throw countError;

    if ((count ?? 0) < report.expected_image_count) {
      return new Response(
        JSON.stringify({
          error: `Not all images registered. Expected ${report.expected_image_count}, got ${count ?? 0}.`,
          registered: count ?? 0,
          expected: report.expected_image_count,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Finalize ──────────────────────────────────────────────────────────
    const { data: finalized, error: updateError } = await supabase
      .from('reports')
      .update({ status: 'finalized' })
      .eq('id', report_id)
      .select('id, status, updated_at')
      .single();

    if (updateError) throw updateError;

    return new Response(JSON.stringify(finalized), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[finalize-report]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
