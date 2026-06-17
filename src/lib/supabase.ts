// src/lib/supabase.ts
// Shared Supabase client. Server-side routes use the service role key
// (full access, bypasses RLS) since this is an internal team tool.

import { createClient } from "@supabase/supabase-js";

// Next.js patches global fetch and caches GET requests by default for any route
// it can statically analyze. Without this, routes with no params/dynamic APIs
// (e.g. /api/analytics, /api/follow-ups) get their first response cached forever.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) } }
);
