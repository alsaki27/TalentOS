import { notFound } from "next/navigation";
import { getCurrentUserContext, hasRole } from "@/lib/auth";
import { assertBrowserWorkerPrepareEnabled, BrowserWorkerPrepareError } from "@/server/services/browserWorkerPrepareService";
import PilotPairing from "./pilot-pairing";

export const dynamic = "force-dynamic";

export default async function BrowserWorkerPilotPage() {
  let scope;
  try {
    scope = assertBrowserWorkerPrepareEnabled();
  } catch (error) {
    if (error instanceof BrowserWorkerPrepareError && error.status === 404) notFound();
    throw error;
  }
  if (scope.mode !== "production-pilot") notFound();
  const staff = await getCurrentUserContext();
  if (!staff || !hasRole(staff.profile, ["admin", "manager"])) notFound();
  return <PilotPairing applicationId={scope.applicationId} />;
}
