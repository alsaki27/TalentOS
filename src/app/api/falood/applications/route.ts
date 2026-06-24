// src/app/api/falood/applications/route.ts
// CRUD for falood_saved_applications — replaces Prisma-based resumify-next API
// Uses TalentOS's native Neon driver.

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/server/db/neon";

export const runtime = "nodejs";

function safeParseJson<T>(value: unknown): T | unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

function normalizeRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    skills: safeParseJson<string[]>(row.skills),
    resumeData: safeParseJson<any>(row.resumeData),
    chatHistory: safeParseJson<any[]>(row.chatHistory),
  };
}

// GET — list all, or get one by ?id=
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const row = await queryOne<any>(
        `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
                job_description AS "jobDescription", company_name AS "companyName",
                skills, resume_data AS "resumeData", chat_history AS "chatHistory"
         FROM falood_saved_applications WHERE id = $1`,
        [id]
      );
      if (!row) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: normalizeRow(row) });
    }

    const rows = await query<any>(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
              job_description AS "jobDescription", company_name AS "companyName",
              skills, resume_data AS "resumeData", chat_history AS "chatHistory"
       FROM falood_saved_applications ORDER BY updated_at DESC`
    );
    return NextResponse.json({ success: true, data: rows.map(normalizeRow) });
  } catch (e: any) {
    console.error("[Falood Applications GET]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// POST — create a new saved application
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobDescription, companyName, skills, resumeData, chatHistory } = body;

    if (!resumeData) {
      return NextResponse.json({ success: false, error: "Missing resumeData" }, { status: 400 });
    }

    const row = await queryOne<any>(
      `INSERT INTO falood_saved_applications
         (job_description, company_name, skills, resume_data, chat_history)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at AS "createdAt"`,
      [
        jobDescription || null,
        companyName || null,
        skills || [],
        JSON.stringify(resumeData),
        JSON.stringify(chatHistory || []),
      ]
    );

    return NextResponse.json({ success: true, data: row });
  } catch (e: any) {
    console.error("[Falood Applications POST]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// DELETE — delete by ?id=
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
  }

  try {
    await execute("DELETE FROM falood_saved_applications WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[Falood Applications DELETE]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
