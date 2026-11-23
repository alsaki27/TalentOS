import { mutateCandidateCustomActivity } from "@/server/services/candidateCustomActivityService";
type Context = { params: { id: string; activityId: string } };
export function PATCH(request: Request, { params }: Context) { return mutateCandidateCustomActivity(request, params, "PATCH"); }
export function DELETE(request: Request, { params }: Context) { return mutateCandidateCustomActivity(request, params, "DELETE"); }
