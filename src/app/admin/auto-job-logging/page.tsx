import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth";
import AutoJobLoggingClient from "./client";

export const dynamic = "force-dynamic";

export default async function ScheduledCandidateLoggingPage() {
  const context = await getCurrentUserContext();
  if (!context) redirect("/login");
  if (context.profile.role !== "admin") redirect("/candidates");
  return <AutoJobLoggingClient />;
}
