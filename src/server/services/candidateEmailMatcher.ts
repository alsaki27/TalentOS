// Deterministic, no-AI candidate matching for the single shared Gmail
// inbox (see Planning MD Files/"TalentOS — Single Shared Gmail Inbox
// Redesign 6 August 2026.md"). Before the shared-mailbox redesign, "which
// candidate does this email belong to" was answered for free by which
// per-candidate mailbox it arrived in. Once every candidate's mail lands in
// one inbox via forwarding, this module is the only thing that answers that
// question - tried in strict priority order, stopping at the first hit.
// Anything that clears none of these tiers is intentionally left
// unresolved (candidate_id = NULL) rather than guessed, and surfaces in the
// "Unassigned" queue for a one-click manual match instead.
//
// The only consumer is gmailSyncService.ts's storeRawMessage path for the
// shared mailbox.

import { query, queryOne } from "@/server/db/neon";
import { parseForwardedHeaders, extractEmailAddress } from "@/lib/integrations/forwardedMessageParser";

export type CandidateMatchMethod = "thread_continuity" | "candidate_email" | "known_contact" | "company_domain";

export interface CandidateMatchInput {
  gmailThreadId: string;
  fromEmail: string | null;
  toEmails: string[] | null;
  bodyText: string | null;
}

export interface CandidateMatchResult {
  candidateId: string | null;
  method: CandidateMatchMethod | null;
}

// Personal webmail domains are never a real employer's apply-link domain,
// so including them in the tier-4 domain match would only ever produce
// noise (or, worse, a coincidental cross-candidate false positive). Excluded
// defensively even though in practice a job's apply_url is essentially
// never hosted on one of these.
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "live.com", "protonmail.com", "msn.com", "me.com",
]);

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export async function matchCandidateForMessage(input: CandidateMatchInput): Promise<CandidateMatchResult> {
  // Tier 1: thread continuity - cheapest and most reliable once a thread's
  // first message has been correctly matched (by any tier, including manual).
  const priorInThread = await queryOne<{ candidate_id: string }>(
    `SELECT candidate_id FROM email_communications
      WHERE gmail_thread_id = $1 AND candidate_id IS NOT NULL
      ORDER BY sent_at ASC LIMIT 1`,
    [input.gmailThreadId],
  );
  if (priorInThread?.candidate_id) {
    return { candidateId: priorInThread.candidate_id, method: "thread_continuity" };
  }

  // Collect every address this message is plausibly associated with: its
  // own From/To, plus - for a manually-forwarded message - the original
  // sender/recipients recovered from Gmail's quoted forward-header block.
  const addresses = new Set<string>();
  const fromAddr = extractEmailAddress(input.fromEmail);
  if (fromAddr) addresses.add(fromAddr);
  for (const to of input.toEmails ?? []) {
    const addr = extractEmailAddress(to);
    if (addr) addresses.add(addr);
  }
  const forwarded = parseForwardedHeaders(input.bodyText);
  if (forwarded) {
    const origFrom = extractEmailAddress(forwarded.from);
    if (origFrom) addresses.add(origFrom);
    for (const to of [...forwarded.to, ...forwarded.cc]) {
      const addr = extractEmailAddress(to);
      if (addr) addresses.add(addr);
    }
  }
  if (addresses.size === 0) return { candidateId: null, method: null };
  const addressList = Array.from(addresses);

  // Tier 2: direct candidate-email match.
  const directMatches = await query<{ id: string }>(
    `SELECT DISTINCT id FROM candidates WHERE lower(email) = ANY($1::text[])`,
    [addressList],
  );
  if (directMatches.length === 1) return { candidateId: directMatches[0].id, method: "candidate_email" };
  // More than one candidate shares an address in this set (e.g. a CC'd
  // recruiter who is also, coincidentally, a candidate) - never guess.
  if (directMatches.length > 1) return { candidateId: null, method: null };

  // Tier 3: known Gmail contact - an address TalentOS has already linked to
  // one specific candidate from a prior, correctly-matched email.
  const knownContacts = await query<{ candidate_id: string }>(
    `SELECT DISTINCT candidate_id FROM gmail_contact_profiles WHERE lower(email) = ANY($1::text[])`,
    [addressList],
  );
  if (knownContacts.length === 1) return { candidateId: knownContacts[0].candidate_id, method: "known_contact" };
  if (knownContacts.length > 1) return { candidateId: null, method: null };

  // Tier 4: active-application company-domain match, auto-assigned only
  // when exactly one candidate's active application resolves to one of
  // these domains. A shared ATS domain (Greenhouse, Workday, ...) naturally
  // matches many candidates at once and correctly falls through to
  // "unresolved" here instead of being guessed.
  const domains = Array.from(
    new Set(addressList.map(domainOf).filter((d): d is string => d !== null && !PERSONAL_EMAIL_DOMAINS.has(d))),
  );
  if (domains.length > 0) {
    const domainMatches = await query<{ candidate_id: string }>(
      `SELECT DISTINCT a.candidate_id
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
        WHERE a.status NOT IN ('rejected', 'withdrawn')
          AND regexp_replace(lower(COALESCE(j.apply_url, j.source_url, '')), '^https?://(www\\.)?([^/]+).*$', '\\2')
              = ANY($1::text[])`,
      [domains],
    );
    if (domainMatches.length === 1) return { candidateId: domainMatches[0].candidate_id, method: "company_domain" };
  }

  // Tier 5: unresolved - lands in the Unassigned queue for a manual match.
  return { candidateId: null, method: null };
}
