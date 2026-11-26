import { query, queryOne } from "@/server/db/neon";
import { sha256Hex } from "@/lib/sha256";
import { currentTerms } from "@/lib/candidateAgreementTerms";
import { CANDIDATE_AGREEMENT_VERSION } from "@/lib/candidatePortalAgreementVersion";
import { CANDIDATE_PRIVACY_NOTICE_VERSION } from "@/lib/candidatePortalAgreementVersion";
import type { ContractSigningInput } from "@/lib/contractSignature";
import { renderSignedContractPdf } from "./contractSigningPdf";
import { isGraphMailConfigured, sendGraphMail } from "@/lib/msGraphMail";

export async function saveSignedContract(
  candidateId: string,
  input: ContractSigningInput,
  hasSsn: boolean,
  ciphertext: string | null,
  terms = currentTerms({}),
) {
  const versions = [
    candidateId,
    terms.version,
    CANDIDATE_PRIVACY_NOTICE_VERSION,
  ];
  const existing = await queryOne<{ id: string; signer_email: string }>(
    "SELECT id,signer_email FROM candidate_signed_contracts WHERE candidate_id=$1 AND agreement_version=$2 AND privacy_notice_version=$3",
    versions,
  );
  if (existing) return existing;
  const id = crypto.randomUUID(),
    signedAt = new Date().toISOString(),
    agreementHash = await sha256Hex(terms.text);
  const pdf = await renderSignedContractPdf({
    ...input,
    id,
    signedAt,
    agreement: terms.text,
    agreementRuns: terms.runs,
    agreementVersion: terms.version,
    privacyVersion: CANDIDATE_PRIVACY_NOTICE_VERSION,
    agreementHash,
  });
  const saved = await queryOne<{ id: string; signer_email: string }>(
    `WITH target AS (SELECT id FROM candidates WHERE id=$1 AND NOT has_contract AND COALESCE(contract_terms_version,$16)=$2 FOR UPDATE), signed AS (
 INSERT INTO candidate_signed_contracts(id,candidate_id,agreement_version,privacy_notice_version,agreement_text,agreement_sha256,signer_name,signer_email,signature,signing_date,signed_at,pdf_base64,pdf_sha256)
 SELECT $4,target.id,$2,$3,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13 FROM target
 ON CONFLICT(candidate_id,agreement_version,privacy_notice_version) DO NOTHING RETURNING id,candidate_id
 ), accepted AS (
 INSERT INTO candidate_portal_acceptances(candidate_id,agreement_version,privacy_notice_version,terms_accepted,agreement_scrolled_to_end,data_processing_consent)
 SELECT candidate_id,$2,$3,true,true,true FROM signed
 ON CONFLICT(candidate_id,agreement_version,privacy_notice_version) DO NOTHING
 ), ssn AS (
 INSERT INTO candidate_ssn_records(candidate_id,has_ssn,last4_ciphertext,privacy_notice_version)
 SELECT candidate_id,$14,$15,$3 FROM signed
 ON CONFLICT(candidate_id) DO UPDATE SET has_ssn=EXCLUDED.has_ssn,last4_ciphertext=EXCLUDED.last4_ciphertext,privacy_notice_version=EXCLUDED.privacy_notice_version,captured_at=now()
 ), deliveries AS (
 INSERT INTO candidate_contract_deliveries(contract_id,recipient)
 SELECT signed.id,recipients.email FROM signed CROSS JOIN (SELECT $8::text AS email UNION SELECT 'info@skarion.com') recipients
 ON CONFLICT DO NOTHING
 ), contracted AS (UPDATE candidates SET has_contract=true WHERE id IN (SELECT candidate_id FROM signed))
 SELECT id,$8::text AS signer_email FROM signed`,
    [
      ...versions,
      id,
      terms.text,
      agreementHash,
      input.signerName,
      input.signerEmail,
      JSON.stringify(input.signature),
      input.signingDate,
      signedAt,
      pdf.toString("base64"),
      await sha256Hex(pdf),
      hasSsn,
      ciphertext,
      CANDIDATE_AGREEMENT_VERSION,
    ],
  );
  const result =
    saved ??
    (await queryOne<{ id: string; signer_email: string }>(
      "SELECT id,signer_email FROM candidate_signed_contracts WHERE candidate_id=$1 AND agreement_version=$2 AND privacy_notice_version=$3",
      versions,
    ));
  if (!result) throw new Error("Agreement changed");
  return result;
}

export async function processContractDeliveries() {
  if (!isGraphMailConfigured() && !process.env.RESEND_API_KEY)
    return { sent: 0, pending: true };
  const jobs = await query<{
    id: string;
    contract_id: string;
    recipient: string;
    pdf_base64: string;
    pdf_sha256: string;
  }>(`WITH picked AS (
 SELECT id FROM candidate_contract_deliveries WHERE sent_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 4 FOR UPDATE SKIP LOCKED
 ), claimed AS (UPDATE candidate_contract_deliveries d SET lease_until=now()+interval '5 minutes',attempts=attempts+1 FROM picked WHERE d.id=picked.id RETURNING d.*)
 SELECT claimed.id,claimed.contract_id,claimed.recipient,c.pdf_base64,c.pdf_sha256 FROM claimed JOIN candidate_signed_contracts c ON c.id=claimed.contract_id`);
  let sent = 0;
  for (const job of jobs) {
    try {
      if (
        (await sha256Hex(Buffer.from(job.pdf_base64, "base64"))) !==
        job.pdf_sha256
      )
        throw new Error("Integrity failure");
      const attachment = {
        name: "Skarion-signed-agreement.pdf",
        contentType: "application/pdf",
        contentBytes: job.pdf_base64,
      };
      const subject = "Your signed Skarion agreement",
        html =
          "<p>Attached is a copy of the signed Skarion service agreement. Please retain it for your records.</p>";
      if (isGraphMailConfigured()) {
        const result = await sendGraphMail({
          to: job.recipient,
          subject,
          html,
          attachments: [attachment],
        });
        if (!result.success) throw new Error("Mail provider rejected delivery");
      } else {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `contract-${job.id}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || "TalentOS <onboarding@resend.dev>",
            to: [job.recipient],
            subject,
            html,
            attachments: [
              { filename: attachment.name, content: job.pdf_base64 },
            ],
          }),
        });
        if (!response.ok) throw new Error("Mail provider rejected delivery");
      }
      await query(
        "UPDATE candidate_contract_deliveries SET sent_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1",
        [job.id],
      );
      sent++;
    } catch {
      await query(
        "UPDATE candidate_contract_deliveries SET lease_until=NULL,next_attempt_at=now()+interval '15 minutes',last_error='Delivery unsuccessful; retry scheduled' WHERE id=$1",
        [job.id],
      );
    }
  }
  return { sent, processed: jobs.length };
}
