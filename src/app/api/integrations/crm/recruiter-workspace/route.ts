// Install as TalentOS src/app/api/integrations/crm/recruiter-workspace/route.ts.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/server/db/neon';
import {
  CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE,
  CRM_RECRUITER_CANDIDATE_STATUS,
} from '@/lib/crmCandidateEligibility';
import {
  normalizeResumeContentForExport,
  resumifyResumeDataToExportDocument,
} from '@/lib/falood/resumeDocumentAdapters';
import { renderResumePdfDoc } from '@/lib/falood/skarionPdfDocument';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = { 'Cache-Control': 'private, no-store' };
type BaseResume = {
  id: string;
  name: string;
  target_industry: string | null;
  updated_at: string | Date;
};

function filename(name: string) {
  return (
    (
      name
        .replace(/[^a-z0-9 ._()-]/gi, '_')
        .trim()
        .slice(0, 150) || 'Approved base resume'
    ).replace(/\.pdf$/i, '') + '.pdf'
  );
}

function version(updated: string | Date) {
  return new Date(updated).toISOString();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: 'Unauthorized CRM integration request.' },
      { status: 401, headers: cache }
    );
  }
  const params = new URL(req.url).searchParams;
  const candidateId = params.get('candidateId'),
    resumeId = params.get('resumeId');
  if (
    (candidateId && !uuid.test(candidateId)) ||
    (resumeId && (!candidateId || !uuid.test(resumeId)))
  ) {
    return NextResponse.json(
      { error: 'Invalid candidate or resume ID.' },
      { status: 400, headers: cache }
    );
  }
  if (!candidateId) {
    const includesPaused = params.get('includePaused') === 'true';
    const stages = includesPaused
      ? [CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE, 'paused']
      : [CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE];
    const candidates = await query(
      `SELECT id,candidate_number,name,lower(pipeline_stage) AS pipeline_stage FROM candidates
      WHERE lower(status)=$1 AND lower(pipeline_stage)=ANY($2::text[]) AND nullif(trim(name),'') IS NOT NULL
      ORDER BY name,id`,
      [CRM_RECRUITER_CANDIDATE_STATUS, stages]
    );
    return NextResponse.json(
      { candidates, includesPaused, observedAt: new Date().toISOString() },
      { headers: cache }
    );
  }
  if (!resumeId) {
    const resumes = await query<BaseResume>(
      `SELECT id,name,target_industry,updated_at FROM base_resumes
      WHERE candidate_id=$1 AND status='approved' ORDER BY updated_at DESC,id`,
      [candidateId]
    );
    return NextResponse.json(
      {
        resumes: (resumes ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          filename: filename(item.name),
          version: version(item.updated_at),
          target_industry: item.target_industry,
        })),
      },
      { headers: cache }
    );
  }
  const resume = await queryOne<BaseResume & { content: Record<string, unknown> | null }>(
    `SELECT id,name,target_industry,updated_at,content FROM base_resumes
    WHERE id=$1 AND candidate_id=$2 AND status='approved'`,
    [resumeId, candidateId]
  );
  if (!resume)
    return NextResponse.json(
      { error: 'Approved base resume not found.' },
      { status: 404, headers: cache }
    );
  const content = resume.content;
  if (!content || (!content.header && !content.personalInfo)) {
    return NextResponse.json(
      { error: 'Open this resume in TalentOS to export its file.' },
      { status: 422, headers: cache }
    );
  }
  const document = content.header
    ? normalizeResumeContentForExport(content)
    : resumifyResumeDataToExportDocument(content);
  if (!document.header?.fullName?.trim()) {
    return NextResponse.json(
      { error: 'The approved resume has no document header.' },
      { status: 422, headers: cache }
    );
  }
  // Use the existing TalentOS PDF renderer on stored content. No AI generation.
  const buffer = renderResumePdfDoc(document).output('arraybuffer') as ArrayBuffer;
  return new Response(buffer, {
    headers: {
      ...cache,
      'Content-Type': 'application/pdf',
      'X-Resume-Filename': filename(resume.name),
      'X-Resume-Version': version(resume.updated_at),
    },
  });
}
