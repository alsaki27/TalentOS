// GET /api/admin/ai-agent-configs -> list all agent configs
// PUT /api/admin/ai-agent-configs -> update one agent config (body: { automation_id, ...fields })
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { listAgentConfigs, updateAgentConfig } from "@/server/repositories/aiAgentConfigRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const configs = await listAgentConfigs();
  return NextResponse.json({ configs });
}

export async function PUT(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { automation_id, ...fields } = body;
  if (!automation_id) {
    return NextResponse.json({ error: "automation_id is required" }, { status: 400 });
  }

  const updated = await updateAgentConfig(automation_id, fields, context?.profile.user_id);
  if (!updated) {
    return NextResponse.json({ error: "Agent config not found" }, { status: 404 });
  }

  return NextResponse.json({ config: updated });
}
