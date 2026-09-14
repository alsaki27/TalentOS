// Deterministic (non-AI) filtering for incoming candidate Gmail, applied
// before storage and again before AI triage. Two goals: (1) never spend AI
// budget classifying mail nobody needs a decision on, (2) never ask a
// candidate's AE to reply to a sender that can't receive one.
//
// `classifyGmailMessage` is the real engine. `gmailSuppressionReason` is a
// backward-compatible wrapper kept only for the pre-existing 3-bucket
// (job_alert / personal_transaction / bulk_marketing) callers and tests -
// its output is byte-identical to the pre-Chunk-A implementation for every
// case that already reached it. New call sites should use
// `classifyGmailMessage` directly, since it exposes signals the old
// function structurally cannot (forceNeedsReplyFalse, storeButHide,
// senderClass, rule).

export type GmailSuppressionReason =
  | "job_alert"            // legacy sender+content AND-gate, unchanged
  | "job_board_alert"      // new: sender-shape-driven, catches single-job alerts
  | "non_actionable_application" // receipt/status mail with no next step
  | "non_actionable_rejection"   // automated rejection/closed-loop status mail
  | "non_actionable_account"     // verification/account housekeeping mail
  | "personal_transaction"
  | "bulk_marketing";

export interface GmailFilterInput {
  from?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  snippet?: string | null;
}

export type GmailSenderClass = "job_board_alert" | "no_reply" | "human";

export interface GmailFilterVerdict {
  /** Drop before storage entirely - never written to the DB, never billed for AI. */
  suppress: boolean;
  /** Store the row, but mark it not relevant and skip AI - recoverable via a "show hidden mail" toggle. */
  storeButHide: boolean;
  reason: GmailSuppressionReason | null;
  senderClass: GmailSenderClass;
  /** True whenever the sender structurally cannot receive a reply (job-board
   *  alert or no-reply address), regardless of whether the message itself
   *  gets suppressed. A sender that says "do not reply" cannot need one. */
  forceNeedsReplyFalse: boolean;
  /** Audit string identifying which rule produced this verdict. */
  rule: string;
}

// `from` is the raw RFC 5322 header ("Acme Careers <noreply@indeed.com>"),
// stored verbatim by gmailApi.ts and passed through unparsed everywhere
// upstream of here. Every rule below needs the address's local-part/domain
// split, not the display name - without this, sender-shape rules would
// silently never match anything but the rare bare-address header.
function parseSender(from: string | null | undefined): { local: string; domain: string } {
  const raw = (from || "").toLowerCase();
  const addr = raw.match(/<([^>]+)>/)?.[1]?.trim() ?? raw.trim();
  const at = addr.lastIndexOf("@");
  return {
    local: at > 0 ? addr.slice(0, at) : addr,
    domain: at > 0 ? addr.slice(at + 1) : "",
  };
}

const JOB_BOARD_DOMAIN =
  /(^|\.)(indeed|indeedemail|linkedin|ziprecruiter|glassdoor|monster|dice|simplyhired|careerbuilder|jobcase|snagajob|lensa|adzuna|jobrapido|talent|jooble|neuvoo)\.(com|net|org|co\.uk|ca|io)$/i;

// ATS and university-career platforms commonly send bulk "applications are
// open" / profile-verification mail. Keep this vendor-neutral at the
// decision point: it is only a machine-sender signal, and an actionable
// interview/recruiter message still wins below via the concrete-next-step
// check.
const ATS_DOMAIN =
  /(^|\.)((avature|workday|myworkday|icims|greenhouse|lever|smartrecruiters|taleo|successfactors|jobvite|oraclecloud|ashby|recruitee|bamboohr|ultipro|paylocity|applicantpro|applicantstack|hirebridge|clearcompany|bullhorn|paradox|eightfold)\.(com|net|org|io)|myworkdayjobs\.com)$/i;

// Machine-generated alert/digest local parts on a job-board domain.
const ALERT_LOCAL =
  /(^|[._+-])(job|jobs|jobalert|jobalerts|job-alerts|jobs-listings|jobs-noreply|jobalerts-noreply|jobseeker|alert|alerts|match|matches|recommend|recommendations|digest|newsletter|invitetoapply|talentnetwork|notification|notifications|updates)([._+-]|$)/i;

// Human-relay local parts on the same domains - these must always survive
// regardless of what else matches, since they carry real recruiter/employer
// correspondence through the job board's messaging system.
const HUMAN_RELAY_LOCAL =
  /(^|[._+-])(inmail|inmail-hit-reply|message|messages|message-reply|reply|employer|recruiter|hiring|interview|candidate-reply|invitations)([._+-]|$)/i;

// Broader alert-shaped subject phrasing (used only on a job-board domain,
// for the store-but-hide tier - too fuzzy to justify an irreversible drop).
const JOB_ALERT_SUBJECT =
  /(\d+\+?\s+(new\s+)?(jobs?|matches|openings)|new jobs?( for| near| matching)?|job alert|your job alert|jobs (for|near|matching) you|based on your (profile|search|searches|activity)|because you (viewed|applied|searched)|top jobs|jobs picked for you|urgently hiring|hiring near you|(is|are|now) hiring|apply now|recommended (jobs|for you)|you look like a great fit|sponsored job)/i;

// The exact live-leak shape: "Cabinet Manufacturing Engineer @ SouthernStone
// Cabinets, LLC". No human writes a subject line like this; a job board
// always does - safe enough to drop pre-storage rather than just hide.
const TITLE_AT_COMPANY_SUBJECT = /^[^@\n<>]{3,90}\s+@\s+[^@\n<>]{2,90}$/;

// First-person recruiter/conversational language. Beats every alert
// heuristic above it - a real person writing to a candidate must never be
// silently dropped because their employer happens to relay mail through a
// job board's domain.
const HUMAN_CONVERSATION =
  /(\bi'?m\b|\bi wanted\b|\bwe'?d (like|love)\b|your (interview|candidacy)|are you (available|free|interested)|schedule a (call|chat|time|screen)|phone screen|hiring manager|following up (on|with) your|sent you a message|replied to your message)/i;

// Receipt-only messages are not useful to the operating inbox. Keep them out
// unless the same message contains a real next step (interview, assessment,
// scheduling, offer, or a request for information). This intentionally uses
// message content, not a hardcoded sender list, because ATS vendors vary.
const NON_ACTIONABLE_APPLICATION_RECEIPT =
  /((?:(?:thank you|thanks)(?: very much| so much)? for (?:(?:taking the time to )?(?:submit|send)|(?:your )?(?:recent )?(?:interest|applying|application|submitting|submission|resume|cv)))|(?:application|resume|cv|candidate profile|profile)\s+(?:has been|was|is)?\s*(?:received|submitted|successfully submitted|confirmed|started|viewed|sent to)|(?:started|begin(?:ned)?|created|completed) (?:your )?(?:candidate )?profile|we (?:have )?received your (?:job )?(?:application|resume|cv|submission)|resume (?:submission )?received|cv (?:submission )?received|application confirmation|application was viewed|application was sent to|received your (?:job )?application|(?:application|candidate profile|profile) (?:started|began|received|submitted|confirmed|completed|viewed)|(?:complete|finish|continue) your (?:job )?application|application reminder|consent kit|document request|application\/onboarding)/i;

const NON_ACTIONABLE_REJECTION =
  /((?:we (?:regret|are sorry)|we (?:will not|won['’]?t) be moving forward|not be moving forward|moving forward with other candidates|move forward with other candidates|decided to pursue other candidates|chosen to (?:explore|move forward with) other candidates|selected another candidate|position (?:has been|was) filled|your application (?:was|has been) (?:not selected|declined|unsuccessful)|not the best match|unable to offer you further consideration|file will be closed)|(?:thank you|thanks) for your interest(?: in (?:the )?(?:position|role|opportunity|joining|our team))?)/i;

const NON_ACTIONABLE_ACCOUNT_EVENT =
  /(verification code|one[- ]time (?:password|code)|\botp\b|sign[- ]in link|confirm your identity|verify (?:your )?(?:email|account|identity|candidate (?:account|profile))|confirm your (?:email|account|identity)|account created|password reset|reset your password|activate your (?:account|candidate profile)|complete your candidate profile|security alert)/i;

// Promotion/campaign mail can mention
// "recruiting", "offerings", or generic opportunities without creating work.
// A machine campaign is retained only when it contains a concrete next step.
const CONCRETE_NEXT_STEP =
  /(?:would like to (?:set up|schedule)|(?:we(?:['’]d)?|we would) (?:like|love) to (?:speak|chat|connect|discuss)|please\s+(?:respond|share|provide|confirm|choose|select|let me know|reply with|reply by)|(?:can you|could you|would you)[\s\S]{0,100}(?:respond|reply with|reply by|share|provide|confirm|choose|select|let me know|schedule|availability|available|dates?|times?)|are you (?:available|free|interested)|(?:scheduled|set up|add it to the schedule)[\s\S]{0,120}(?:interview|test|screen|call|meeting)|(?:interview|phone screen|video screen|onsite|assessment|coding (?:challenge|test)|technical (?:test)|task (?:round|assignment))[\s\S]{0,100}(?:confirm|respond|reply with|reply by|please (?:confirm|respond|let me know)|can you|could you|would you|available|dates?|times?)|(?:interview|phone screen|video screen|onsite|assessment) (?:is|has been)?\s*(?:scheduled|confirmed|invitation)|offer (?:letter|details|the (?:position|role|job)|you (?:the )?(?:position|role|job))\b)/i;

const NON_ACTIONABLE_PROMOTION =
  /(new jobs? posted|job alert|jobs? for you|recommended jobs?|you look like a great fit|top jobs?|hiring near you|sponsored job|weekly newsletter|special offer|limited[- ]time|promotional email|unsubscribe|applications? (?:are|is|now)?\s*(?:open|available|live)|open positions|career profile|new hiring opportunities|job opportunities)/i;

// Machine-generated/no-reply local parts, independent of domain - this is
// what lets forceNeedsReplyFalse apply to no-reply senders on ANY domain,
// not just job boards.
const NO_REPLY_LOCAL =
  /(^|[._+-])(no[_-]?reply|do[_-]?not[_-]?reply|donotreply|noreply|automated|auto[_-]?reply|mailer-daemon|bounce[sd]?|postmaster|unsubscribe|notification|notifications)([._+-]|$)/i;

export function classifyGmailMessage(msg: GmailFilterInput): GmailFilterVerdict {
  const { local, domain } = parseSender(msg.from);
  const subjectRaw = (msg.subject || "").trim();
  const subject = subjectRaw.toLowerCase();
  const preview = `${subject}\n${msg.snippet || ""}\n${msg.bodyText || ""}`.toLowerCase().slice(0, 4000);
  const senderRaw = (msg.from || "").toLowerCase();
  const personalSender = /(doordash|ubereats|uber\.com|lyft|instacart|amazon|walmart|target|bestbuy|fedex|ups|usps|dhl|delta|united|airbnb|booking\.com|venmo|paypal|chase|bankofamerica|wellsfargo|citi|capitalone|cvs|walgreens|mychart)/i.test(senderRaw);

  const onJobBoardDomain = JOB_BOARD_DOMAIN.test(domain);
  const onAtsDomain = ATS_DOMAIN.test(domain);
  const isAlertLocal = ALERT_LOCAL.test(local);
  const isNoReplyLocal = NO_REPLY_LOCAL.test(local);
  // `do_not_reply` contains the token "reply" but is explicitly machine
  // generated; it must never take the human-relay escape hatch.
  const isHumanRelay = HUMAN_RELAY_LOCAL.test(local) && !isNoReplyLocal;

  let senderClass: GmailSenderClass = "human";
  if (onJobBoardDomain && isAlertLocal && !isHumanRelay) senderClass = "job_board_alert";
  else if (isNoReplyLocal) senderClass = "no_reply";

  // A subject that directly asks the candidate to schedule/confirm an
  // interview is actionable even when the body is absent from Gmail's list
  // payload. The body-only rule remains deliberately stricter so conditional
  // boilerplate such as "we will contact you to schedule an interview" does
  // not rescue a receipt.
  const hasConcreteNextStep =
    CONCRETE_NEXT_STEP.test(preview) ||
    /\b(?:schedule|confirm) (?:your|an?|the) (?:interview|phone screen|video screen|onsite|assessment|test|call|meeting)\b/i.test(subjectRaw);

  // Closed-loop rejection/decline messages do not create work for the AE.
  // They are filtered using content, not a sender allow/deny list, and an
  // interview, assessment, scheduling, offer, or information request in the
  // same message keeps it available.
  if (NON_ACTIONABLE_REJECTION.test(preview) && !hasConcreteNextStep) {
    return {
      suppress: true, storeButHide: false, reason: "non_actionable_rejection", senderClass,
      forceNeedsReplyFalse: true,
      rule: "application:closed_loop_rejection",
    };
  }

  // High-confidence noise is rejected before the human-conversation rescue.
  // A receipt that also contains an interview/assessment/scheduling signal is
  // retained, while a receipt-only message is never written to the database.
  if (NON_ACTIONABLE_APPLICATION_RECEIPT.test(preview) && !hasConcreteNextStep) {
    return {
      suppress: true, storeButHide: false, reason: "non_actionable_application", senderClass,
      forceNeedsReplyFalse: true,
      rule: "application:receipt_only",
    };
  }

  if (NON_ACTIONABLE_ACCOUNT_EVENT.test(preview) && !hasConcreteNextStep) {
    return {
      suppress: true, storeButHide: false, reason: personalSender ? "personal_transaction" : "non_actionable_account", senderClass,
      forceNeedsReplyFalse: true,
      rule: personalSender ? "personal_transaction" : "account:verification_or_housekeeping",
    };
  }

  // Catch job-site digests and promotional alerts even when the vendor is not
  // in the finite list of well-known job-board domains. Machine-shaped senders
  // are required here so a human recruiter mentioning a job is not discarded.
  const machineSender = senderClass !== "human" || onAtsDomain || /(^|[._+-])(jobs?|jobsearch|career|careers|campus|talent|recruiting|recruitment|university|students?|news|newsletter|marketing|promotion|updates?|notification|notifications)([._+-]|$)/i.test(local) || /(?:no-?reply|do-?not-?reply|donotreply|automated|notification|mailer|bounce|unsubscribe)/i.test(local);
  if (machineSender && NON_ACTIONABLE_PROMOTION.test(preview) && !CONCRETE_NEXT_STEP.test(preview)) {
    return {
      suppress: true, storeButHide: false, reason: "job_board_alert", senderClass,
      forceNeedsReplyFalse: true,
      rule: "promotion:machine_alert",
    };
  }

  // 1. Rescue first, always - never suppress or hide past this point.
  if (isHumanRelay || HUMAN_CONVERSATION.test(preview)) {
    return {
      suppress: false, storeButHide: false, reason: null, senderClass,
      forceNeedsReplyFalse: senderClass !== "human",
      rule: isHumanRelay ? "rescue:human_relay_local" : "rescue:human_conversation",
    };
  }

  // 2. Drop pre-storage - narrow, high-confidence job-board-alert shapes only.
  if (onJobBoardDomain && (isAlertLocal || TITLE_AT_COMPANY_SUBJECT.test(subjectRaw))) {
    return {
      suppress: true, storeButHide: false, reason: "job_board_alert", senderClass,
      forceNeedsReplyFalse: true,
      rule: isAlertLocal ? "job_board:alert_local" : "job_board:title_at_company",
    };
  }

  // 3. Store-but-hide - broader job-board alert subject heuristics. Same
  //    zero AI cost as suppression, but reversible: the row exists so a
  //    wrong guess can be found and shown via a "show hidden mail" toggle.
  if (onJobBoardDomain && JOB_ALERT_SUBJECT.test(subject)) {
    return {
      suppress: false, storeButHide: true, reason: "job_board_alert", senderClass,
      forceNeedsReplyFalse: true, rule: "job_board:alert_subject",
    };
  }

  // 4. personal_transaction and bulk_marketing: unchanged AND-gate, tested
  //    against the raw sender string exactly as before Chunk A. These
  //    sender lists include amazon/capitalone/target/chase - domains that
  //    legitimately host recruiting mail (careers@amazon.com) - so this
  //    stays content-gated rather than switching to the sender-shape-only
  //    logic used for job boards above.
  const personalContent = /(order|receipt|delivery|shipment|tracking|invoice|payment|reservation|ride|trip|verification code|one-time password|security alert|prescription|appointment)/i.test(preview);
  if (personalSender && personalContent) {
    return { suppress: true, storeButHide: false, reason: "personal_transaction", senderClass, forceNeedsReplyFalse: true, rule: "personal_transaction" };
  }

  const bulkSender = /(newsletter|marketing|promotions?|deals?|offers?)@|list-unsubscribe/i.test(senderRaw);
  const bulkContent = /(unsubscribe|weekly newsletter|special offer|limited-time deal|promotional email)/i.test(preview);
  if (bulkSender && bulkContent) {
    return { suppress: true, storeButHide: false, reason: "bulk_marketing", senderClass, forceNeedsReplyFalse: true, rule: "bulk_marketing" };
  }

  // 5. Original job_alert AND-gate, unchanged - a fallback for anything the
  //    newer sender-shape rules above didn't already catch.
  const jobAlertSender = /(indeed\.com|linkedin\.com|ziprecruiter\.com|glassdoor\.com|monster\.com)/i.test(senderRaw);
  const jobAlertContent = /(job alert|jobs for you|recommended for you|you look like a great fit|jobs you may like|sponsored job|new jobs match)/i.test(preview);
  if (jobAlertSender && jobAlertContent) {
    return { suppress: true, storeButHide: false, reason: "job_alert", senderClass, forceNeedsReplyFalse: true, rule: "job_alert" };
  }

  return { suppress: false, storeButHide: false, reason: null, senderClass, forceNeedsReplyFalse: senderClass !== "human", rule: "none" };
}

/** @deprecated Pre-Chunk-A API, kept only for the original test file and any
 *  external reference. Remaps the newer "job_board_alert" reason back to
 *  "job_alert" so every case that reached this function before Chunk A gets
 *  the exact same return value now. New code should call
 *  classifyGmailMessage directly - this wrapper cannot express
 *  storeButHide or forceNeedsReplyFalse. */
export function gmailSuppressionReason(message: GmailFilterInput): GmailSuppressionReason | null {
  const verdict = classifyGmailMessage(message);
  if (!verdict.suppress) return null;
  return verdict.reason === "job_board_alert" ? "job_alert" : verdict.reason;
}
