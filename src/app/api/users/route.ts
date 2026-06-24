import { NextRequest, NextResponse } from "next/server";
import { publicUserProfile, requireCurrentUser, type UserRole } from "@/lib/auth";
import { hashPassword } from "@/server/auth/crypto";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

const roles: UserRole[] = ["admin", "manager", "application_engineer"];

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  let data: any[];

  if (isNeon()) {
    let sql = 'SELECT user_id, email, display_name, role, is_active FROM profiles ORDER BY display_name ASC';
    const params: any[] = [];
    if (context?.profile.role !== "admin") {
      sql = 'SELECT user_id, email, display_name, role, is_active FROM profiles WHERE is_active = $1 ORDER BY display_name ASC';
      params.push(true);
    }
    data = await query(sql, params);
  } else {
    const { supabase } = await import("@/lib/supabase");
    let dbQuery = supabase
      .from("profiles")
      .select("user_id, email, display_name, role, is_active")
      .order("display_name", { ascending: true });

    if (context?.profile.role !== "admin") {
      dbQuery = dbQuery.eq("is_active", true);
    }

    const res = await dbQuery;
    data = res.data ?? [];
  }

  return NextResponse.json((data ?? []).map((profile) => publicUserProfile(profile as any)));
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

  const existingProfile = await queryOne<{ user_id: string }>(
    "SELECT user_id FROM profiles WHERE LOWER(email) = $1",
    [email]
  );
  if (existingProfile) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  // Generate user_id and hash password
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  let profile: any;

  if (isNeon()) {
    profile = await queryOne(
      `INSERT INTO profiles (user_id, email, display_name, role, is_active, password_hash, email_verified, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active,
         password_hash = EXCLUDED.password_hash,
         updated_at = EXCLUDED.updated_at
       RETURNING user_id, email, display_name, role, is_active`,
      [userId, email, displayName, role, true, passwordHash, true, new Date().toISOString()]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("profiles")
      .upsert({
        user_id: userId,
        email,
        display_name: displayName,
        role,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("user_id, email, display_name, role, is_active")
      .single();
    profile = res.data;
  }

  if (!profile) {
    return NextResponse.json({ error: "Could not create user." }, { status: 500 });
  }

  if (isNeon()) {
    await execute(
      'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        context?.profile.user_id,
        context?.profile.email,
        'user.created',
        'profile',
        userId,
        { email, role },
      ]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("audit_logs").insert({
      actor_user_id: context?.profile.user_id,
      actor_email: context?.profile.email,
      action: "user.created",
      entity_type: "profile",
      entity_id: userId,
      metadata: { email, role },
    });
  }

  return NextResponse.json(publicUserProfile(profile as any), { status: 201 });
}
