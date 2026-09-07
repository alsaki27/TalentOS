import { NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { configuredSharedGmailEmail } from "@/server/runtimeConfig";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let data: any;
  let error: any;

  try {
    // There is one authoritative mailbox now.  Return only that configured
    // address to every authenticated staff member so the inbox header can
    // show the real sync state without exposing retired personal connections.
    const sharedEmail = configuredSharedGmailEmail();
    const canManage = hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES);
    data = await query(
      `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at,
              $2::boolean AS can_manage
         FROM integration_accounts
        WHERE provider = 'gmail'
          AND owner_type = 'shared_application_mailbox'
          AND lower(email) = $1::text
        ORDER BY updated_at DESC`,
      [sharedEmail, canManage],
    );
    error = null;
  } catch (err: any) {
    error = { message: err.message };
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
