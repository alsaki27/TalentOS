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
    versions: safeParseJson<any[]>(row.versions || '[]'),
  };
}

// GET — list all, or get one by ?id=
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const row = await queryOne<any>(
        `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
                name, job_description AS "jobDescription", company_name AS "companyName",
                skills, resume_data AS "resumeData", chat_history AS "chatHistory",
                candidate_id AS "candidateId", versions
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
              name, job_description AS "jobDescription", company_name AS "companyName",
              skills, resume_data AS "resumeData", chat_history AS "chatHistory", versions
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
    const { name, jobDescription, companyName, skills, resumeData, chatHistory, candidateId } = body;

    if (!resumeData) {
      return NextResponse.json({ success: false, error: "Missing resumeData" }, { status: 400 });
    }

    const row = await queryOne<any>(
      `INSERT INTO falood_saved_applications
         (name, job_description, company_name, skills, resume_data, chat_history, candidate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at AS "createdAt"`,
      [
        name || null,
        jobDescription || null,
        companyName || null,
        skills || [],
        JSON.stringify(resumeData),
        JSON.stringify(chatHistory || []),
        candidateId || null,
      ]
    );

    return NextResponse.json({ success: true, data: row });
  } catch (e: any) {
    console.error("[Falood Applications POST]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PATCH — update an existing saved application by ?id=
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    if ("name" in body) {
      updates.push(`name = $${values.length + 1}`);
      values.push(body.name || null);
    }

    if ("jobDescription" in body) {
      updates.push(`job_description = $${values.length + 1}`);
      values.push(body.jobDescription || null);
    }

    if ("companyName" in body) {
      updates.push(`company_name = $${values.length + 1}`);
      values.push(body.companyName || null);
    }

    if ("skills" in body) {
      updates.push(`skills = $${values.length + 1}`);
      values.push(body.skills || []);
    }

    if ("resumeData" in body) {
      updates.push(`resume_data = $${values.length + 1}`);
      values.push(JSON.stringify(body.resumeData));
    }

    if ("chatHistory" in body) {
      updates.push(`chat_history = $${values.length + 1}`);
      values.push(JSON.stringify(body.chatHistory || []));
    }

    if ("versions" in body) {
      updates.push(`versions = $${values.length + 1}`);
      values.push(JSON.stringify(body.versions || []));
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);

    const row = await queryOne<any>(
      `UPDATE falood_saved_applications
       SET ${updates.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt",
                 name, job_description AS "jobDescription", company_name AS "companyName",
                 skills, resume_data AS "resumeData", chat_history AS "chatHistory", versions`,
      [...values, id]
    );

    if (!row) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: normalizeRow(row) });
  } catch (e: any) {
    console.error("[Falood Applications PATCH]", e);
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
