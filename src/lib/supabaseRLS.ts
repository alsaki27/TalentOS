// src/lib/supabaseRLS.ts
// NEW Supabase client that uses the ANON key instead of the service role key.
// This client respects RLS policies and is intended for:
//  - client-side browser usage
//  - server-side routes where you want RLS enforcement
//  - testing / gradual migration from the service-role client
//
// The existing supabase.ts (SUPABASE_SERVICE_ROLE_KEY) remains unchanged for
// all existing server-side routes that rely on full table access.

// NEW Supabase client that uses the ANON key instead of the service role key.
// This client respects RLS policies and is intended for:
//  - client-side browser usage
//  - server-side routes where you want RLS enforcement
//  - testing / gradual migration from the service-role client
//
// The existing supabase.ts (SUPABASE_SERVICE_ROLE_KEY) remains unchanged for
// all existing server-side routes that rely on full table access.
//
// Lazy-initialized so that build does not fail when env vars are missing.

import { createClient } from "@supabase/supabase-js";

let _client: any;

function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase RLS client not configured.");
    }
    _client = createClient(url, key, {
      global: { fetch: (url: any, init: any) => fetch(url, { ...init, cache: "no-store" }) },
    });
  }
  return _client;
}

export const supabaseRLS: any = new Proxy({} as any, {
  get(_target, prop) {
    return getClient()[prop];
  },
});
