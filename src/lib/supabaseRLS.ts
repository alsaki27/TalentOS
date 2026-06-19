// src/lib/supabaseRLS.ts
// NEW Supabase client that uses the ANON key instead of the service role key.
// This client respects RLS policies and is intended for:
//  - client-side browser usage
//  - server-side routes where you want RLS enforcement
//  - testing / gradual migration from the service-role client
//
// The existing supabase.ts (SUPABASE_SERVICE_ROLE_KEY) remains unchanged for
// all existing server-side routes that rely on full table access.

import { createClient } from "@supabase/supabase-js";

export const supabaseRLS = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) } }
);
