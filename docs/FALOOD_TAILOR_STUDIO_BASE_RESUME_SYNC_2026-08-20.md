# Falood Tailor Studio → Base Resume Real-Time Sync — 2026-08-20

## The bug that was reported

"Regenerated resumes can't consider the updated resume — it takes previous base resume."

## What it actually was (not what it looked like)

The AI resume pipeline (Job Lens → Resume Forge → Hiring Panel → Final Polish) was never at fault — it was independently re-verified correct three separate times during this investigation (a historical 150-resume audit, a real user click on the production "Regenerate" button, and a deliberate edit-then-regenerate test). Every time, it faithfully reflected whatever was currently in `base_resumes.content`.

The real problem: **`/falood/studio/tailor/[id]`** — the page the edits were made on — reads and writes an entirely separate table, `falood_saved_applications` (its own file header says so directly: *"replaces Prisma-based resumify-next API"*). The AI pipeline has never read from that table. Edits made there saved successfully, every time, but into a table structurally invisible to Generate/Regenerate.

Confirmed directly against the database: two edited Tailor Studio sessions were found holding real, saved edits (name, email, linkedin, location, github) that had never propagated to the corresponding `base_resumes` rows, whose `updated_at` had not moved since before this investigation began.

## Why it wasn't simply "wrong tool, use the other one instead"

`/falood/studio/base/[baseResumeId]` is a separate, correctly-wired editor (confirmed: it calls `GET`/`PATCH /api/base-resumes/[id]` directly). But the Tailor Studio session itself already carries a `name` field in the form `base_resume:<uuid>` — a stored reference back to the base resume it was created from — so the product intent was clearly for edits here to represent edits to that base resume, even though nothing acted on that intent. Per your decision, the fix is to make that link real rather than redirect away from the tool you're already using.

## The fix

`src/app/api/falood/applications/route.ts` — `PATCH` handler. After a Tailor Studio session saves successfully, if its `name` matches `base_resume:<uuid>` and this save included `resumeData`, the resume content is converted from the Tailor Studio's "resumify" shape into the canonical base-resume shape using the existing, already-proven `resumifyResumeDataToExportDocument()` adapter (`src/lib/falood/resumeDocumentAdapters.ts` — previously only used for PDF export), and written into that `base_resumes` row.

**Merge, not overwrite.** The resumify editor has no concept of certifications or the base resume's presentation `formatting` (styleId, margins, etc.) — a blind overwrite would silently delete them on every sync. Only the fields the Tailor Studio can actually edit (header, summary, skills, experience, education, projects, customSections) are synced; everything else on the base resume is left exactly as it was.

**Best-effort.** A sync failure is logged but never fails the Tailor Studio's own save, which has already succeeded by that point — matches the same pattern used elsewhere in this codebase (SharePoint archiving, activity logging).

Runs on every save (the page already auto-saves ~1 second after a change, plus the explicit Save button and Save-as-Version), so this is a real-time sync, not a one-time backfill.

## Verification

See the live test run immediately following this fix's deployment for direct proof: a real edit made in a Tailor Studio session, followed by a real Regenerate, producing a tailored resume that reflects the new content.
