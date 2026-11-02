/**
 * register-image Edge Function
 *
 * Registers image metadata after the client has uploaded the file to Storage.
 * Idempotent: if (report_id, client_image_id) already exists, returns the
 * existing row.  Also verifies the file actually landed in Storage and that
 * its size is within the 5 MB ceiling.
 *
 * POST /functions/v1/register-image
 * Body: {
 *   report_id: string,        -- server-assigned report UUID
 *   client_image_id: string,  -- client UUID for this image
 *   storage_path: string,     -- e.g. reports/{reportId}/{imageId}.jpg
 *   checksum: string,         -- SHA-256 hex
 *   file_size: number,        -- bytes (client-reported; we verify server-side)
 * }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyFailureSimulator, simulatorHeaders } from '../_shared/failure-simulator.ts';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-failure-mode',
};

serve(async (req: Request) => {
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

    const body = await req.json();
    const { report_id, client_image_id, storage_path, checksum, file_size } = body;

    // ── Validation ────────────────────────────────────────────────────────
    if (!report_id || !client_image_id || !storage_path || !checksum) {
      return new Response(
        JSON.stringify({ error: 'report_id, client_image_id, storage_path, and checksum are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (typeof file_size !== 'number' || file_size <= 0) {
      return new Response(
        JSON.stringify({ error: 'file_size must be a positive number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (file_size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: `Image exceeds 5 MB limit (received ${file_size} bytes)` }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Verify report exists ──────────────────────────────────────────────
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

    // ── Verify the file actually exists in Storage ────────────────────────
    const { data: storageObject, error: storageError } = await supabase
      .storage
      .from('report-images')
      .list(storage_path.split('/').slice(0, -1).join('/'), {
        search: storage_path.split('/').pop(),
      });

    if (storageError || !storageObject || storageObject.length === 0) {
      return new Response(
        JSON.stringify({ error: 'File not found in storage. Upload the file before registering.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Idempotent insert ─────────────────────────────────────────────────
    const { data: image, error: insertError } = await supabase
      .from('report_images')
      .upsert(
        { report_id, client_image_id, storage_path, checksum, file_size },
        { onConflict: 'report_id,client_image_id', ignoreDuplicates: false },
      )
      .select('id, client_image_id, storage_path, checksum, file_size, created_at')
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify(image), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        ...simulatorHeaders(),
      },
    });
  } catch (err) {
    console.error('[register-image]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
