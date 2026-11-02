/**
 * create-report Edge Function
 *
 * Creates a report record idempotently.  If the idempotency_key already exists
 * the function returns the existing row instead of creating a duplicate.
 *
 * POST /functions/v1/create-report
 * Body: { idempotency_key: string, description: string, expected_image_count: number }
 * Returns: { id, idempotency_key, status, created_at }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyFailureSimulator, simulatorHeaders } from '../_shared/failure-simulator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-failure-mode',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Failure simulation (dev only) ────────────────────────────────────────
  const simResponse = await applyFailureSimulator(req);
  if (simResponse) return simResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const { idempotency_key, description, expected_image_count } = body;

    // ── Input validation ──────────────────────────────────────────────────
    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return new Response(JSON.stringify({ error: 'idempotency_key is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'description is required and must be non-blank' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (
      typeof expected_image_count !== 'number' ||
      expected_image_count < 1 ||
      expected_image_count > 5
    ) {
      return new Response(
        JSON.stringify({ error: 'expected_image_count must be an integer between 1 and 5' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Idempotent upsert ─────────────────────────────────────────────────
    // ON CONFLICT returns the existing row unchanged (no data mutation on retry).
    const { data, error } = await supabase
      .from('reports')
      .upsert(
        {
          idempotency_key,
          description: description.trim(),
          expected_image_count,
          status: 'pending',
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: false },
      )
      .select('id, idempotency_key, status, expected_image_count, created_at')
      .single();

    if (error) throw error;

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        ...simulatorHeaders(),
      },
    });
  } catch (err) {
    console.error('[create-report]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
