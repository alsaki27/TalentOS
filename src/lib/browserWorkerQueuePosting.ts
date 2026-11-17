const postingSource = "COALESCE(NULLIF(BTRIM(j.apply_url), ''), BTRIM(j.source_url))";
const postingPattern = '^(https://www[.]linkedin[.]com/jobs/view/[1-9][0-9]{0,24})/?([?][!"$-~]*)?$';
const maxPostingLength = 2048;
const matchPosting = new RegExp(postingPattern);

/** Used against the jobs alias `j`. Returns the native posting URL, with no tracking query. */
export const BROWSER_QUEUE_JOB_URL_SQL = `(CASE WHEN octet_length(${postingSource}) <= ${maxPostingLength} THEN
  substring(${postingSource} COLLATE "C" FROM '${postingPattern}')
END)`;

export function browserQueueJobUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const source = value.replace(/^ +| +$/g, "");
  const posting = source.length <= maxPostingLength ? matchPosting.exec(source) : null;
  return posting?.[0] === source ? posting[1] : null;
}
