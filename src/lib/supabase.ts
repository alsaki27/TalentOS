// src/lib/supabase.ts
// Shared Supabase client. Server-side routes use the service role key
// (full access, bypasses RLS) since this is an internal team tool.
// Lazy-initialized so that build does not fail when env vars are missing.
// Cloudflare migration note: this module will be replaced by a Neon-compatible
// client when the migration happens. The exported `supabase` object is the stable
// interface.

import { createClient } from "@supabase/supabase-js";

export const supabase: any = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url: any, init: any) => fetch(url, { ...init, cache: "no-store" }),
      },
    })
  : new Proxy({} as any, {
      get() {
        return () => {
          throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
        };
      },
    });
