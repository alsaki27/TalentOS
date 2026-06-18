import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, publicUserProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function authClient() {
  const url = process.env.SUPABASE_URL;
  const authKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !authKey) return null;

  return createClient(url, authKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const client = authClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase auth environment variables are required for login." },
      { status: 500 },
    );
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Invalid login." }, { status: 401 });
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("user_id, email, display_name, role, is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  let profile = existingProfile;
  if (!profile) {
    const { data: insertedProfile, error: insertError } = await supabase
      .from("profiles")
      .insert({
        user_id: data.user.id,
        email: data.user.email,
        display_name: data.user.user_metadata?.display_name ?? data.user.email?.split("@")[0] ?? "User",
        role: data.user.user_metadata?.role ?? "recruiter",
      })
      .select("user_id, email, display_name, role, is_active")
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    profile = insertedProfile;
  }

  const { count: adminCount } = await supabase
    .from("profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true);

  if ((adminCount ?? 0) === 0 && profile) {
    const { data: adminProfile, error: adminError } = await supabase
      .from("profiles")
      .update({ role: "admin", updated_at: new Date().toISOString() })
      .eq("user_id", profile.user_id)
      .select("user_id, email, display_name, role, is_active")
      .single();

    if (adminError) return NextResponse.json({ error: adminError.message }, { status: 500 });
    profile = adminProfile;
  }

  if (!profile?.is_active) {
    return NextResponse.json({ error: "This user is inactive." }, { status: 403 });
  }

  const secure = process.env.NODE_ENV === "production";
  cookies().set(ACCESS_TOKEN_COOKIE, data.session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: data.session.expires_in,
  });
  cookies().set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({
    user: { id: data.user.id, email: data.user.email },
    profile: publicUserProfile(profile),
  });
}
