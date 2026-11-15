import { canAccessInterviewDetails } from "@/lib/applicationInterviewAccess";
import { queryOne } from "@/server/db/neon";

type ApplicationStageFields = { status: string | null; application_stage: string | null; ae_stage: string | null };

export async function getApplicationInterviewAccess(applicationId: string) {
  const application = await queryOne<ApplicationStageFields>(
    "SELECT status, application_stage, ae_stage FROM applications WHERE id = $1",
    [applicationId],
  );
  return {
    exists: Boolean(application),
    allowed: application ? canAccessInterviewDetails(application.status, application.application_stage, application.ae_stage) : false,
  };
}
