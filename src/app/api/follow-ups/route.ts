// src/app/api/follow-ups/route.ts
// GET -> every application with a follow-up date set, joined with candidate + job info,
// soonest first.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("applications")
    .select("id, status, follow_up_at, next_action, candidates(id, name), jobs(id, title, company)")
    .not("follow_up_at", "is", null)
    .order("follow_up_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
