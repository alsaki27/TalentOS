// Parses Gmail's standard quoted "forwarded message" header block out of a
// plain-text email body. When a candidate's mail arrives via a mail-server
// level forward, the original From/To headers survive untouched and this
// parser is never needed. When someone forwards manually (clicks "Forward"
// in Gmail), the new message's own From is the forwarder, and the original
// sender only survives as this quoted block:
//
//   ---------- Forwarded message ---------
//   From: Jane Recruiter <jane@company.com>
//   Date: Mon, Sep 1, 2026 at 10:00 AM
//   Subject: Interview invitation
//   To: Candidate Name <candidate@gmail.com>
//
// This is the one deterministic signal available to recover the true
// original sender without AI - see candidateEmailMatcher.ts, which is the
// only consumer of this module.

export interface ForwardedHeaders {
  from: string | null;
  to: string[];
  cc: string[];
  date: string | null;
  subject: string | null;
}

// Gmail's marker varies in dash count/spacing across clients and locales
// ("---------- Forwarded message ---------", "----- Forwarded message -----",
// etc.) but always contains the words "Forwarded message" between runs of
// dashes on their own line.
const FORWARD_MARKER = /^[-–—]{2,}\s*forwarded message\s*[-–—]{2,}\s*$/im;

const HEADER_LINE = /^(From|Date|Subject|To|Cc)\s*:\s*(.*)$/i;

function splitAddressList(value: string): string[] {
  // Header values are comma-separated "Name <email>" or bare-email entries.
  // A naive split(",") would break on a display name containing a comma
  // ("Doe, Jane <jane@x.com>"), so split on commas that are not inside <>.
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "<") depth++;
    if (ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Scans a message body for Gmail's standard forwarded-header block and
 * extracts the original From/To/Cc/Date/Subject. Returns null when no such
 * block is present (a non-forwarded message just uses its own real headers,
 * nothing for this parser to do).
 */
export function parseForwardedHeaders(bodyText: string | null | undefined): ForwardedHeaders | null {
  if (!bodyText) return null;
  const match = FORWARD_MARKER.exec(bodyText);
  if (!match) return null;

  const afterMarker = bodyText.slice(match.index + match[0].length);
  const lines = afterMarker.split(/\r?\n/);

  const headers: ForwardedHeaders = { from: null, to: [], cc: [], date: null, subject: null };
  let sawAnyHeader = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // A blank line ends the header block once at least one header has
      // been captured; a leading blank line right after the marker is
      // skipped (common formatting) and does not terminate the scan.
      if (sawAnyHeader) break;
      continue;
    }
    const headerMatch = HEADER_LINE.exec(line);
    if (!headerMatch) {
      // Not a recognized header line — either the body has started, or this
      // client wraps a header value onto the next line. Treat as end of
      // the header block rather than guessing at continuation semantics.
      if (sawAnyHeader) break;
      continue;
    }
    sawAnyHeader = true;
    const [, name, value] = headerMatch;
    switch (name.toLowerCase()) {
      case "from":
        headers.from = value.trim() || null;
        break;
      case "date":
        headers.date = value.trim() || null;
        break;
      case "subject":
        headers.subject = value.trim() || null;
        break;
      case "to":
        headers.to = splitAddressList(value);
        break;
      case "cc":
        headers.cc = splitAddressList(value);
        break;
    }
  }

  return sawAnyHeader ? headers : null;
}

/**
 * Extracts a bare, lowercased email address from a "Name <email>" or plain
 * "email" header-value string. Returns null when nothing address-shaped is
 * found.
 */
export function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const angled = value.match(/<([^<>]+)>/)?.[1];
  const candidate = (angled || value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}
