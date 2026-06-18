import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, type UserRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const roles: UserRole[] = ["admin", "manager", "application_engineer", "recruiter"];

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  let query = supabase
    .from("profiles")
    .select("user_id, email, display_name, role, is_active")
    .order("display_name", { ascending: true });

  if (context?.profile.role !== "admin") {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim();
  const role = body.role as UserRole;

  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "Name, email, and temporary password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }
  if (!roles.includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      role,
    },
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Could not create user." }, { status: 500 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert({
      user_id: created.user.id,
      email,
      display_name: displayName,
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("user_id, email, display_name, role, is_active")
    .single();

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "user.created",
    entity_type: "profile",
    entity_id: created.user.id,
    metadata: { email, role },
  });

  return NextResponse.json(profile, { status: 201 });
}
