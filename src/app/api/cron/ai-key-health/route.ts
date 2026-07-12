// GET /api/cron/ai-key-health -> recovers AI keys from transient failure states
// Runs via scheduled-jobs workflow. Gated by CRON_SECRET.
//
// Checks keys stuck in rate_limited, quota_exhausted, or failing status and
// tests them. Successful tests recover the key to "working". Failed tests
// increment the failure counter. Keys with status "disabled" or "invalid" are skipped.

import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/server/db/neon";
import { testAiKey } from "@/server/services/aiProvider";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface RecoveryKey {
  id: string;
  provider: string;
  label: string;
  status: string;
  failure_count: number;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recoveryStatuses = ["rate_limited", "quota_exhausted", "failing"];

  const keys = await query<RecoveryKey>(
    `SELECT id, provider, label, status, failure_count
     FROM ai_api_keys
     WHERE is_enabled = true
       AND status = ANY($1::text[])
     ORDER BY status ASC, failure_count ASC`,
    [recoveryStatuses]
  );

  if (keys.length === 0) {
    console.log("[ai-key-health] No keys in recovery states. Skipping.");
    return NextResponse.json({ ok: true, tested: 0, recovered: 0, failed: 0 });
  }

  console.log(`[ai-key-health] Testing ${keys.length} keys in recovery states...`);

  let recovered = 0;
  let failed = 0;
  const results: { id: string; provider: string; label: string; previousStatus: string; success: boolean; error?: string; latencyMs: number }[] = [];

  for (const key of keys) {
    console.log(`[ai-key-health] Testing key ${key.id} (${key.provider} / ${key.label}), status=${key.status}`);
    const result = await testAiKey(key.id);

    if (result.success) {
      recovered++;
      console.log(`[ai-key-health] Key ${key.id} recovered -> working (${result.latencyMs}ms)`);
    } else {
      failed++;
      console.log(`[ai-key-health] Key ${key.id} still failing: ${result.error} (${result.latencyMs}ms)`);
    }

    results.push({
      id: key.id,
      provider: key.provider,
      label: key.label,
      previousStatus: key.status,
      success: result.success,
      error: result.error,
      latencyMs: result.latencyMs,
    });
  }

  console.log(`[ai-key-health] Done. Tested=${keys.length}, recovered=${recovered}, failed=${failed}`);

  return NextResponse.json({
    ok: true,
    tested: keys.length,
    recovered,
    failed,
    results,
  });
}
