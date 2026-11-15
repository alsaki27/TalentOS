import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { UUID_PATTERN, downloadInterviewPreparation, updateInterviewPreparation } from "@/server/services/interviewPreparationFiles";

type Params = { params: { id: string; scheduleId: string; fileId: string } };

function validIds({ id, scheduleId, fileId }: Params["params"]) {
  return [id, scheduleId, fileId].every((value) => UUID_PATTERN.test(value));
}

export async function GET(request: Request, { params }: Params) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!validIds(params)) return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  return downloadInterviewPreparation(request, params.id, params.scheduleId, params.fileId);
}

export async function PATCH(request: Request, { params }: Params) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!validIds(params)) return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.remove === true) return updateInterviewPreparation(params.id, params.scheduleId, params.fileId, context.profile, { remove: true });
  if (typeof body?.visible !== "boolean") return NextResponse.json({ error: "Specify file visibility." }, { status: 400 });
  return updateInterviewPreparation(params.id, params.scheduleId, params.fileId, context.profile, { visible: body.visible });
}
