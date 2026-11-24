import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES } from "@/lib/extensionAuth";
import { queryOne } from "@/server/db/neon";

export async function authenticateRecorder(request: NextRequest) {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;
  const auth = await authenticateExtension(request, EXTENSION_SCOPES.submissionRecordsWrite);
  if (auth instanceof NextResponse) return auth;
  if (!auth.key.owner_user_id) return extensionError("key_owner_required", "This recorder requires a team-member-owned API key.", 403);
  const owner = await queryOne<{ user_id: string }>("SELECT user_id FROM profiles WHERE user_id=$1 AND is_active=true", [auth.key.owner_user_id]);
  if (!owner) return extensionError("key_owner_inactive", "This API key's owner is no longer active.", 403);
  return { key: auth.key, ownerId: owner.user_id };
}
