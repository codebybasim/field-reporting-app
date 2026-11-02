/**
 * Type-safe environment variable access via react-native-dotenv.
 * Values are inlined at bundle time from the .env file.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, ENABLE_FAILURE_SIMULATOR } from '@env';

if (!SUPABASE_URL) {
  throw new Error(
    'SUPABASE_URL is not set. Copy .env.example to .env and fill in your Supabase project values.',
  );
}
if (!SUPABASE_ANON_KEY) {
  throw new Error(
    'SUPABASE_ANON_KEY is not set. Copy .env.example to .env and fill in your Supabase project values.',
  );
}

export const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  FAILURE_SIMULATOR_ENABLED: ENABLE_FAILURE_SIMULATOR === 'true',
} as const;
