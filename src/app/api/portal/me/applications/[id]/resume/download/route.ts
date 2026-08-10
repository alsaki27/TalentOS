import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

function parseContent(value: unknown): any {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

function renderMarkdown(content: any, generatedText: string | null) {
  if (!content?.header && generatedText) return generatedText;
  const header = content?.header || {};
  const lines: string[] = [];
  if (header.fullName) lines.push(`# ${header.fullName}`);
  const contact = [header.location, header.email, header.phone, header.linkedin, header.github, header.portfolio].filter(Boolean);
  if (contact.length) lines.push(contact.join(" · "));
  if (content?.summary?.text) lines.push("\n## Summary\n", content.summary.text);
  if (Array.isArray(content?.skills) && content.skills.length) {
    lines.push("\n## Skills");
    for (const section of content.skills) if (section?.skills?.length) lines.push(`**${section.title || "Skills"}**: ${section.skills.join(", ")}`);
  }
  if (Array.isArray(content?.experience) && content.experience.length) {
    lines.push("\n## Experience");
    for (const item of content.experience) {
      lines.push(`\n### ${item.title || "Role"} — ${item.company || "Company"}`);
      const dates = [item.startDate, item.endDate || (item.startDate ? "Present" : "")].filter(Boolean).join(" – ");
      if (dates) lines.push(dates);
      for (const bullet of item.bullets || []) if (bullet?.text) lines.push(`- ${bullet.text}`);
    }
  }
  if (Array.isArray(content?.projects) && content.projects.length) {
    lines.push("\n## Projects");
    for (const item of content.projects) {
      lines.push(`\n### ${item.name || item.title || "Project"}`);
      if (item.description) lines.push(item.description);
      for (const bullet of item.bullets || []) if (bullet?.text) lines.push(`- ${bullet.text}`);
    }
  }
  if (Array.isArray(content?.education) && content.education.length) {
    lines.push("\n## Education");
    for (const item of content.education) lines.push(`- ${[item.degree, item.school, item.graduationDate].filter(Boolean).join(" · ")}`);
  }
  if (Array.isArray(content?.certifications) && content.certifications.length) {
    lines.push("\n## Certifications");
    for (const item of content.certifications) lines.push(`- ${[item.name, item.issuer, item.date].filter(Boolean).join(" · ")}`);
  }
  return lines.join("\n").trim() || "Tailored resume content is unavailable.";
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const format = new URL(request.url).searchParams.get("format") || "markdown";
  if (format !== "markdown" && format !== "text") {
    return NextResponse.json({ error: "PDF and DOCX downloads are generated in your browser from the protected preview." }, { status: 501 });
  }

  const resume = await queryOne<any>(
    `SELECT rv.title, rv.generated_text, rv.content
     FROM applications a
     JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     LEFT JOIN application_packets packet ON packet.application_id = a.id AND packet.final_resume_version_id = rv.id
     WHERE a.id = $1
       AND a.candidate_id = $2
       AND a.resume_generation_status = 'ready'
       AND rv.application_id = a.id
       AND rv.candidate_id = a.candidate_id
       AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent'))`,
    [params.id, context.candidateId],
  );
  if (!resume) return NextResponse.json({ error: "Tailored resume is not ready" }, { status: 404 });

  const body = renderMarkdown(parseContent(resume.content), resume.generated_text);
  const safeTitle = String(resume.title || "tailored_resume").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle || "tailored_resume"}.md"`,
      "Cache-Control": "private, no-store",
    },
  });
}
