import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { UUID_PATTERN, downloadInterviewPreparation, updateInterviewPreparation } from "@/server/services/interviewPreparationFiles";

type RouteContext = { params: { id: string; fileId: string } };

export async function GET(request: Request, { params }: RouteContext) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (![params.id, params.fileId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  }
  return downloadInterviewPreparation(request, params.id, null, params.fileId);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (![params.id, params.fileId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (body?.remove === true) {
    return updateInterviewPreparation(params.id, null, params.fileId, context.profile, { remove: true });
  }
  if (typeof body?.visible !== "boolean") {
    return NextResponse.json({ error: "Specify file visibility." }, { status: 400 });
  }
  return updateInterviewPreparation(params.id, null, params.fileId, context.profile, { visible: body.visible });
}
