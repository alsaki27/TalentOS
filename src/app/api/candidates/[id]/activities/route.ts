import { mutateCandidateCustomActivity } from "@/server/services/candidateCustomActivityService";
export function POST(request: Request, { params }: { params: { id: string } }) {
  return mutateCandidateCustomActivity(request, params, "POST");
}
