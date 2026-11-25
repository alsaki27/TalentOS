# Candidate electronic contract signing

## Reference review

Studied Documenso at commit `cc491f1ec224bda8d3e09338e291ca11fe47641a`:
- `ARCHITECTURE.md`: monorepo, recipient/field model, pluggable storage, background jobs and signing providers.
- `SIGNING.md` and `packages/signing`: certificate sealing is distinct from signature capture.
- `packages/prisma/schema.prisma`: recipients, signatures, document data and audit records.
- `packages/ui/primitives/signature-pad/signature-pad-type.tsx`: typed signature interaction.
- `packages/lib/jobs/definitions/internal/seal-document.handler.ts`: completion checks before PDF finalization, stored source versus final documents, audit trail.
- `packages/lib/jobs/definitions/emails/send-document-completed-emails.handler.ts`: completion delivery uses the saved document and addresses recipients separately.

This is an independent TalentOS implementation, not an embedded Documenso server or copied AGPL source. Documenso's authentication, Prisma schema, licensing and certificate infrastructure are not silently imported into TalentOS.

## User flow

The existing terms and privacy checkboxes stay in place. Below them the candidate enters their full legal name, email for a copy, local signing date, and either a typed signature matching their name or a drawn signature. A separate checkbox confirms intent to sign electronically and delivery to the specified address and info@skarion.com.

The authenticated candidate's ID comes from their portal session. All fields and consent are validated server-side. Drawings contain bounded normalized numeric points, not uploaded SVG/HTML. Candidate-entered text is escaped. The browser renderer cannot fetch external resources. SSN choices continue through the existing encrypted storage flow; SSN digits never enter the signed PDF or email.

The PDF contains the complete current agreement and a signature page with the client's mark, name, copy recipients, entered date, server UTC timestamp, agreement/privacy versions, unique receipt ID and agreement-content SHA-256. This is an electronic signature record, **not a certificate-sealed/PAdES PDF**. Adding that requires a separately configured certificate/signing provider; no legal compliance certification is claimed.

## Persistence and retries

Migration `149_candidate_signed_contracts.sql` creates immutable-by-application signed records and delivery jobs. The full agreement snapshot, validated signature and final PDF bytes/hash are retained in the existing PostgreSQL database. This avoids requiring a new external signing service or storage configuration. Existing uploaded contracts remain in their current storage.

One SQL statement commits the signed PDF, acceptance, encrypted SSN choice, contract status, and recipient delivery rows. The unique candidate/agreement/privacy constraint makes repeat requests reuse the first signed record. The app never overwrites a signed record. A failed PDF render cannot complete onboarding.

Emails attach the saved PDF after checking its SHA-256. Delivery uses Microsoft Graph when configured, otherwise Resend. Missing providers do not count as sent. The existing authenticated email-queue cron retries pending jobs every scheduled run, with 15-minute retry backoff and a five-minute worker lease. Each recipient is tracked separately; no recipient can be supplied to the cron by callers. Resend receives a stable idempotency key. Graph does not guarantee exactly-once delivery: a process failure after provider acceptance but before marking the row can cause a duplicate copy on retry. `sent_at` means provider acceptance, not verified inbox delivery.

The client can download their own latest signed PDF from `/api/portal/me/signed-contract`. Staff list/preview/download use the existing contract-role guard. Raw storage keys, other candidates' documents, and SSN information are not returned. The staff Contract tab shows pending delivery or provider acceptance.

## Deployment

Apply only migration 149 to the approved TalentOS database before releasing this code. The manual deployment input `apply_candidate_signed_contracts=true` selects only this migration; leave other targeted migrations false and `skip_schema_fixes=true`. Existing prerequisites: migration 117, candidate portal auth, the existing `RESUME_BROWSER` Cloudflare binding, and either configured Microsoft Graph mail or Resend. Keep the scheduled email-queue job enabled. No live migration, real signature, or outbound test email is authorized by implementing this code alone.

Existing signed/uploaded-contract candidates and previously completed onboarding are grandfathered; this change does not force them to sign again. New incomplete no-contract onboarding requires the new signature fields. Backups of the database now include private signed PDF contents.

Rollback code while retaining the new tables and signed records. Never drop these tables as a routine rollback. Review access through existing contract roles. Application-level immutability does not prevent a database administrator from changing rows; hashes detect accidental PDF-byte changes, not malicious administrator replacement of both bytes and hash.

## Validation in this change

- 17 focused tests passed: field validation, HTML escaping, onboarding authorization, PDF failure handling, immutable retries, saved-byte delivery, download access control and hash checks, plus migration/persistence against an isolated local PostgreSQL database.
- TypeScript and Next.js production build passed. Lint passed with existing repository warnings. Deployment YAML/shell syntax and Cloudflare production wiring checks passed.
- Browser preview verified typed input, drawing capture and clearing a drawing. A synthetic PDF generated from the same HTML was checked for complete agreement text and first/signature-page layout using WeasyPrint.
- The deployed Cloudflare browser renderer and live mailbox delivery still require release-environment verification. Tests did not sign a real contract or send real email.
