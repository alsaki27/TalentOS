import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { assertStaffOperatorOrigin } from "@/app/api/browser-worker/v2/_http";
import {
  isApplicationFactUuid,
  parseApplicationFactDraft,
  profileMatchesApplicationFact,
} from "@/lib/candidateApplicationFacts";
import {
  createApplicationFactDraft,
  listCandidateApplicationFacts,
  listMissingApplicationQuestions,
  loadApplicationFactProfile,
  reviseApplicationFact,
  reviewApplicationFact,
} from "@/server/services/candidateApplicationFactsService";

type RouteParams = { params: { id: string } };
const headers = { "Cache-Control": "private, no-store" };

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

function serviceError(cause: unknown) {
  if ((cause as { code?: string } | null)?.code === "42P01") {
    return error("Application answers are unavailable until database migration 136 is applied.", 503);
  }
  console.error("[Application facts] Request failed.");
  return error("Could not access application answers.", 500);
}

function staffDraftInput(input: unknown, actorId: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  if (body.sourceKind === "profile") return body;
  if (body.sourceKind !== undefined && body.sourceKind !== "document" && body.sourceKind !== "candidate_attested") return body;
  if (typeof body.sourceRef === "string" && body.sourceRef.trim()) {
    return { ...body, sourceKind: body.sourceKind ?? "document" };
  }
  if (body.sourceRef !== undefined && typeof body.sourceRef !== "string") return body;
  return { ...body, sourceKind: "document", sourceRef: `staff-entry:${actorId}` };
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  if (!isApplicationFactUuid(params.id)) return error("Invalid candidate ID.", 400);
  try {
    const candidateId = params.id.toLowerCase();
    const profile = await loadApplicationFactProfile(candidateId);
    if (!profile) return error("Candidate not found.", 404);
    const facts = await listCandidateApplicationFacts(candidateId);
    const missingQuestions = await listMissingApplicationQuestions(candidateId, profile, facts);
    return NextResponse.json({ facts, missingQuestions }, { headers });
  } catch (cause) {
    return serviceError(cause);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  if (!context || !isApplicationFactUuid(params.id)) return error("Invalid candidate request.", 400);
  const body = await request.json().catch(() => null);
  const approve = body?.approve === true;
  if (approve) {
    try {
      assertStaffOperatorOrigin(request);
    } catch {
      return error("Same-origin operator request required.", 403);
    }
  }
  const draft = parseApplicationFactDraft(staffDraftInput(body, context.profile.user_id));
  if (!draft) return error("Provide a valid question and typed answer.", 400);
  try {
    const profile = await loadApplicationFactProfile(params.id);
    if (!profile) return error("Candidate not found.", 404);
    if (!profileMatchesApplicationFact(draft, profile)) return error("The source profile value changed. Reload before saving.", 409);
    const fact = approve
      ? await createApplicationFactDraft(params.id, draft, context.profile.user_id, true)
      : await createApplicationFactDraft(params.id, draft, context.profile.user_id);
    if (!fact) return error(approve
      ? "Check the expiry. If this candidate already has an answer for the question, edit or review it."
      : "Check the candidate and answer bank limit.", 409);
    return NextResponse.json({ fact }, { status: 201, headers });
  } catch (cause) {
    return serviceError(cause);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  if (!context || !isApplicationFactUuid(params.id)) return error("Invalid candidate request.", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const factId = body?.factId;
  const revision = body?.expectedRevision;
  const operation = body?.operation;
  if (!isApplicationFactUuid(factId) || typeof revision !== "number" || !Number.isInteger(revision) ||
      revision < 1 || revision >= 2147483647 ||
      (operation !== "revise" && operation !== "approve" && operation !== "revoke")) {
    return error("Specify the fact, its current revision, and a review operation.", 400);
  }
  try {
    const actor = context.profile.user_id;
    if (operation === "revise") {
      const draft = parseApplicationFactDraft(staffDraftInput(body?.draft, actor));
      if (!draft) return error("Provide a valid answer revision.", 400);
      const profile = await loadApplicationFactProfile(params.id);
      if (!profile) return error("Candidate not found.", 404);
      if (!profileMatchesApplicationFact(draft, profile)) return error("The source profile value changed. Reload before saving.", 409);
      const fact = await reviseApplicationFact(params.id, factId, revision, draft, actor);
      if (!fact) return error("The question or revision changed. Reload and try again.", 409);
      return NextResponse.json({ fact }, { headers });
    }
    const fact = await reviewApplicationFact(params.id, factId, revision, operation, actor);
    if (!fact) return error("This revision is no longer eligible for the selected action. Reload and review its source and expiry.", 409);
    return NextResponse.json({ fact }, { headers });
  } catch (cause) {
    return serviceError(cause);
  }
}
