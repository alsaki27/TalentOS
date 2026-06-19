// src/lib/supabase.ts
// Shared Supabase client. Server-side routes use the service role key
// (full access, bypasses RLS) since this is an internal team tool.
// Lazy-initialized so that build does not fail when env vars are missing.
// Cloudflare migration note: this module will be replaced by a Neon-compatible
// client when the migration happens. The exported `supabase` object is the stable
// interface.

import { createClient } from "@supabase/supabase-js";

let _client: any;

function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment."
      );
    }
    _client = createClient(url, key, {
      global: {
        fetch: (url: any, init: any) => fetch(url, { ...init, cache: "no-store" }),
      },
    });
  }
  return _client;
}

// Proxy so that existing code using `supabase.from(...)` still works without
// calling createClient at module-import time. Build passes even when env vars
// are absent; runtime requests fail with a clear error if they are missing.
export const supabase: any = new Proxy({} as any, {
  get(_target, prop) {
    return getClient()[prop];
  },
});
