import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const requiredTables = ["profiles", "candidates", "jobs", "applications", "resumes", "audit_logs"];

function present(name: string) {
  const value = process.env[name];
  return Boolean(value && !value.includes("your-") && !value.includes("placeholder"));
}

export async function GET() {
  const env = Object.fromEntries(requiredEnv.map((name) => [name, present(name)]));
  const missingEnv = requiredEnv.filter((name) => !env[name]);
  const hasSupabase = present("SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY");

  const tableStatus: Record<string, boolean> = {};
  let database = {
    connected: false,
    latencyMs: null as number | null,
    error: hasSupabase ? null as string | null : "Supabase URL or service-role key is not configured.",
  };

  if (hasSupabase) {
    const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });

    const started = Date.now();
    const { error } = await client.from("profiles").select("user_id", { head: true, count: "exact" });
    database = {
      connected: !error,
      latencyMs: Date.now() - started,
      error: error ? "Database check failed." : null,
    };

    if (!error) {
      await Promise.all(
        requiredTables.map(async (table) => {
          const { error: tableError } = await client.from(table).select("*", { head: true, count: "exact" });
          tableStatus[table] = !tableError;
        }),
      );
    }
  }

  const tablesOk = requiredTables.every((table) => tableStatus[table]);
  return NextResponse.json({
    status: database.connected && missingEnv.length === 0 && tablesOk ? "ok" : "degraded",
    app: "TalentOS",
    env,
    missingEnv,
    database,
    tables: tableStatus,
  });
}
