/**
 * Supabase client — fully lazy.
 *
 * The @supabase/supabase-js module is NOT imported at module load time.
 * It is require()'d inside getSupabase() on first call.  This prevents
 * loading the Supabase library (and its URL/fetch dependencies) during
 * app launch, which can crash Hermes before polyfills are ready.
 *
 * Usage:
 *   import { getSupabase } from '../supabase/client';
 *   const supabase = getSupabase();
 */

import { ENV } from '../../utils/env';

// Type-only import — erased at compile time, no runtime cost
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  // Lazy require — loads @supabase/supabase-js only when first needed
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');

  _client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return _client;
}
