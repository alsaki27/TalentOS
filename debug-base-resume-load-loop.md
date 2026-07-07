# Debug Session: base-resume-load-loop
- **Status**: [OPEN]
- **Issue**: Base resume page never finishes loading and keeps re-requesting the same base resume every second.
- **Debug Server**: Running at `http://127.0.0.1:7777`
- **Log File**: .dbg/trae-debug-log-base-resume-load-loop.ndjson

## Reproduction Steps
1. Open a base resume page like `/falood/studio/base/<baseResumeId>`.
2. Wait for the editor to load.
3. Observe repeated `GET /api/base-resumes/<baseResumeId>` requests and no completed page load.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The client page component is remounting repeatedly, so the load effect runs from scratch each time. | High | Low | Pending |
| B | A second hidden consumer or nested component is also fetching the same base resume on an interval. | Med | Low | Pending |
| C | The load effect is gated by state that flips back during render, retriggering the fetch path indirectly. | Med | Med | Pending |
| D | Suspense or route param resolution is causing the inner client component to restart repeatedly in dev. | Med | Med | Pending |
| E | A browser-side error during import/render causes recovery/remount loops after each successful fetch. | High | Med | Pending |

## Log Evidence
- Instrumentation added in `src/app/falood/studio/base/[baseResumeId]/page.tsx` for mount/unmount, render commits, fetch lifecycle, import path, and browser errors.
- Awaiting reproduction after refresh to collect `pre-fix` evidence.
- Additional instrumentation added for resume parsing and builder seeding in:
  - `src/lib/resumeParsing.ts`
  - `src/lib/falood/seedFromParsedResume.ts`
  - `src/app/api/base-resumes/route.ts`
  - `src/app/api/candidates/[id]/parse-markitdown/route.ts`
- New logs now capture raw extracted resume text, raw provider output, normalized skill strings, raw-text skill categories, category-selection decisions, and final builder skill sections.

## Verification Conclusion
- Pending.
