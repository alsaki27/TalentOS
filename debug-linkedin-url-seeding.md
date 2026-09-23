# Debug Session: linkedin-url-seeding
- **Status**: [OPEN]
- **Issue**: LinkedIn URL not being populated when creating a base resume seeded from the uploaded resume
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-linkedin-url-seeding.ndjson

## Reproduction Steps
1. Upload a resume PDF for a candidate.
2. Create a base resume with starting source = "uploaded_resume".
3. Open the base resume and check header.linkedin.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The LinkedIn URL exists only as a PDF hyperlink/annotation and is not present in extracted text or markdown | High | Med | Pending |
| B | The LinkedIn URL is present in extracted text/markdown but the regex/normalizer fails to recognize it (e.g., non-/in/ path, spacing, punctuation) | Med | Low | Pending |
| C | The parser produces linkedin_url correctly, but it is dropped during seeding into ResumeDocument.header.linkedin | Low/Med | Low | Pending |
| D | The base resume is seeded from a different resume record (not the latest/original upload) than the one containing LinkedIn | Low | Low | Pending |

## Log Evidence
- Pre-fix evidence (from Debug Server logs):
  - `extractedTextLength: 0`, `markdownHasLinkedInWord: true`, but `extractedLinkedInFromMarkdown: null`
  - PDF binary scan found `linkedin.com/in/roy-bhaskar/` even though text extraction did not
  - Parser returned `parsedLinkedinUrl: null`, and seeded header had `seededHeaderLinkedin: null`

## Verification Conclusion
[Pre-fix vs post-fix comparison]
