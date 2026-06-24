import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { updateApplication } from "@/server/repositories/applicationsRepository";

export async function PATCH(req: NextRequest, { params }: { params: { applicationId: string } }) {
  const { response } = await requirePublicApiScope(req, "reminders:write");
  if (response) return response;

  const body = await req.json();
  const complete = body.complete === true;
  const updates = complete
    ? { follow_up_at: null, follow_up_source: null, follow_up_completed_at: new Date().toISOString(), next_action: body.next_action || null }
    : {
      follow_up_at: body.follow_up_at,
      next_action: body.next_action || null,
      follow_up_source: body.follow_up_source || "public_api",
      follow_up_created_at: new Date().toISOString(),
      follow_up_completed_at: null,
    };

  if (isNeon()) {
    try {
      const data = await updateApplication(params.applicationId, updates);
      return NextResponse.json(data);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } else {
    const { data, error } = await supabase.from("applications").update(updates).eq("id", params.applicationId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
}
