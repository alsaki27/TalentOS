import { NextRequest, NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { encryptCandidateSsnLast4 } from "@/server/privacy/candidateSsnCrypto";
import { queryOne } from "@/server/db/neon";
import { CANDIDATE_AGREEMENT_TEXT, CANDIDATE_AGREEMENT_VERSION } from "@/lib/candidatePortalAgreement";
import { CANDIDATE_PRIVACY_NOTICE_VERSION } from "@/lib/candidatePortalAgreementVersion";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const { context, response } = await requireCurrentCandidate({ allowIncompleteOnboarding: true });
  if (response) return response;

  const required = !context.candidate.has_contract && !context.candidate.onboarding_complete;
  return NextResponse.json({
    required,
    candidateName: context.candidate.name,
    agreementVersion: CANDIDATE_AGREEMENT_VERSION,
    privacyNoticeVersion: CANDIDATE_PRIVACY_NOTICE_VERSION,
    ...(required ? { agreementText: CANDIDATE_AGREEMENT_TEXT } : {}),
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentCandidate({ allowIncompleteOnboarding: true });
  if (response) return response;
  if (context.candidate.has_contract || context.candidate.onboarding_complete) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Submit the required onboarding choices." }, { status: 400, headers: NO_STORE });
  }
  if (body.agreementVersion !== CANDIDATE_AGREEMENT_VERSION || body.privacyNoticeVersion !== CANDIDATE_PRIVACY_NOTICE_VERSION) {
    return NextResponse.json({ error: "The agreement has changed. Reload it and review the current version." }, { status: 409, headers: NO_STORE });
  }
  if (body.termsAccepted !== true || body.agreementScrolledToEnd !== true || body.dataProcessingConsent !== true) {
    return NextResponse.json({ error: "Both acknowledgments are required to continue." }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.hasSsn !== "boolean") {
    return NextResponse.json({ error: "Choose Yes or No for the Social Security Number question." }, { status: 400, headers: NO_STORE });
  }

  let encryptedLast4: string | null = null;
  if (body.hasSsn) {
    const last4 = typeof body.ssnLast4 === "string" ? body.ssnLast4 : "";
    if (!/^\d{4}$/.test(last4)) {
      return NextResponse.json({ error: "Enter exactly the last four digits of your SSN." }, { status: 400, headers: NO_STORE });
    }
    try {
      encryptedLast4 = await encryptCandidateSsnLast4(last4, context.candidateId);
    } catch {
      return NextResponse.json({ error: "Secure SSN storage is not configured. Contact the Skarion team." }, { status: 503, headers: NO_STORE });
    }
  } else if (body.ssnLast4 !== undefined && body.ssnLast4 !== "") {
    return NextResponse.json({ error: "Do not submit SSN digits when No is selected." }, { status: 400, headers: NO_STORE });
  }

  try {
    const saved = await queryOne<{ candidate_id: string }>(
      `WITH accepted AS (
         INSERT INTO candidate_portal_acceptances (
           candidate_id, agreement_version, terms_accepted, agreement_scrolled_to_end, privacy_notice_version, data_processing_consent
         )
         VALUES ($1, $2, TRUE, TRUE, $3, TRUE)
         ON CONFLICT (candidate_id, agreement_version, privacy_notice_version)
         DO UPDATE SET terms_accepted = TRUE, agreement_scrolled_to_end = TRUE, data_processing_consent = TRUE
         RETURNING candidate_id
       ), saved_ssn AS (
         INSERT INTO candidate_ssn_records (candidate_id, has_ssn, last4_ciphertext, privacy_notice_version, captured_at)
         SELECT candidate_id, $4, $5, $3, NOW() FROM accepted
         ON CONFLICT (candidate_id)
         DO UPDATE SET has_ssn = EXCLUDED.has_ssn,
                       last4_ciphertext = EXCLUDED.last4_ciphertext,
                       privacy_notice_version = EXCLUDED.privacy_notice_version,
                       captured_at = NOW()
         RETURNING candidate_id
       )
       SELECT candidate_id FROM saved_ssn`,
      [context.candidateId, CANDIDATE_AGREEMENT_VERSION, CANDIDATE_PRIVACY_NOTICE_VERSION, body.hasSsn, encryptedLast4],
    );
    if (!saved) throw new Error("Onboarding record was not saved.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Could not save onboarding. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
