import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, type UserRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const roles: UserRole[] = ["admin", "manager", "application_engineer", "recruiter"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("display_name" in body) updates.display_name = String(body.display_name ?? "").trim();
  if ("email" in body) updates.email = body.email ? String(body.email).trim() : null;
  if ("is_active" in body) updates.is_active = Boolean(body.is_active);
  if ("role" in body) {
    if (!roles.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    updates.role = body.role;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("user_id", params.id)
    .select("user_id, email, display_name, role, is_active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
