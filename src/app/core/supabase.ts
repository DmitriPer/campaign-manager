import { InjectionToken } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './supabase.config.generated';

export interface SupabaseHandle {
  /** Project URL, e.g. https://<ref>.supabase.co */
  readonly url: string;
  readonly client: SupabaseClient;
}

/**
 * The single Supabase client for the app. Only the public URL and the publishable key are
 * used in the browser; permissions are enforced by RLS and database functions (A16).
 * Sign-in uses the PKCE flow (A03): Google redirects back with a one-time `?code=`
 * that the client exchanges for a session on load.
 */
export const SUPABASE = new InjectionToken<SupabaseHandle>('SUPABASE', {
  providedIn: 'root',
  factory: () => ({
    url: supabaseConfig.url,
    client: createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }),
  }),
});
