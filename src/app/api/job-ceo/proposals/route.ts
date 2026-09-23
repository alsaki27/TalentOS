import { NextRequest, NextResponse } from "next/server";
import { listProposals, createProposal } from "@/server/repositories/agentConfigProposalRepository";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const proposals = await listProposals(status);
    return NextResponse.json({ proposals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const body = await req.json();
    const proposal = await createProposal({
      targetAutomationId: body.targetAutomationId,
      proposedChanges: body.proposedChanges,
      rationale: body.rationale,
      createdBy: body.createdBy ?? "job_ceo",
    });
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
