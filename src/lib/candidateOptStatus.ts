export const CANDIDATE_OPT_STATUS_FIELDS = [
  { key: "eadWorkAuthorizationType", label: "EAD / Work Authorization Type", column: "ead_work_authorization_type", kind: "text", maxLength: 500 },
  { key: "applicationFiledDate", label: "Application Filed Date", column: "application_filed_date", kind: "date", monthYearColumn: "application_filed_month_year", notProvidedColumn: "application_filed_not_provided" },
  { key: "receiptNoticeDate", label: "Receipt Notice Date", column: "receipt_notice_date", kind: "date", monthYearColumn: "receipt_notice_month_year", notProvidedColumn: "receipt_notice_not_provided" },
  { key: "biometricsDate", label: "Biometrics Date", column: "biometrics_date", kind: "date", monthYearColumn: "biometrics_month_year", notProvidedColumn: "biometrics_not_provided" },
  { key: "processingType", label: "Processing Type", column: "processing_type", kind: "text", maxLength: 500 },
  { key: "premiumProcessingStatus", label: "Premium Processing Status", column: "premium_processing_status", kind: "text", maxLength: 1000 },
  { key: "premiumTriggerPlan", label: "Premium Trigger / Plan", column: "premium_trigger_plan", kind: "text", maxLength: 3000 },
  { key: "uscisCurrentStatus", label: "USCIS Current Status", column: "uscis_current_status", kind: "text", maxLength: 3000 },
  { key: "approvalDate", label: "Approval Date", column: "approval_date", kind: "date", monthYearColumn: "approval_month_year", notProvidedColumn: "approval_not_provided" },
  { key: "cardProducedDate", label: "Card Produced Date", column: "card_produced_date", kind: "date", monthYearColumn: "card_produced_month_year", notProvidedColumn: "card_produced_not_provided" },
  { key: "cardMailedDate", label: "Card Mailed Date", column: "card_mailed_date", kind: "date", monthYearColumn: "card_mailed_month_year", notProvidedColumn: "card_mailed_not_provided" },
  { key: "eadCardReceivedDate", label: "EAD Card Received Date", column: "ead_card_received_date", kind: "date", monthYearColumn: "ead_card_received_month_year", notProvidedColumn: "ead_card_received_not_provided" },
  { key: "expectedStartWorkEligibleDate", label: "Expected Start / Work-Eligible Date", column: "expected_start_work_eligible_date", kind: "text", maxLength: 2000 },
  { key: "readyForFullApplicationVolume", label: "Ready for Full Application Volume?", column: "ready_for_full_application_volume", kind: "text", maxLength: 500 },
  { key: "daysPending", label: "Days Pending", column: "days_pending", kind: "text", maxLength: 500 },
  { key: "notes", label: "Notes", column: "notes", kind: "text", maxLength: 10000 },
] as const;

export const CANDIDATE_OPT_STATUS_NOT_PROVIDED = "Not Provided" as const;

export type CandidateOptStatusFieldKey = (typeof CANDIDATE_OPT_STATUS_FIELDS)[number]["key"];
export type CandidateOptStatusData = Record<CandidateOptStatusFieldKey, string | null>;

export interface CandidateOptStatusRecord {
  id: string;
  candidateId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: CandidateOptStatusData;
}

export function emptyCandidateOptStatusData(): CandidateOptStatusData {
  return Object.fromEntries(CANDIDATE_OPT_STATUS_FIELDS.map(({ key }) => [key, null])) as CandidateOptStatusData;
}

export type CandidateOptStatusParseResult =
  | { ok: true; data: CandidateOptStatusData }
  | { ok: false; error: string };

export interface CandidateOptStatusDbEntry {
  column: string;
  value: string | boolean | null;
}

export function candidateOptStatusDbEntries(data: CandidateOptStatusData): CandidateOptStatusDbEntry[] {
  const entries: CandidateOptStatusDbEntry[] = [];
  for (const field of CANDIDATE_OPT_STATUS_FIELDS) {
    const value = data[field.key];
    if (field.kind === "text") {
      entries.push({ column: field.column, value });
      continue;
    }
    const isNotProvided = value === CANDIDATE_OPT_STATUS_NOT_PROVIDED;
    const isMonthYear = typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
    entries.push(
      { column: field.column, value: typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null },
      { column: field.monthYearColumn, value: isMonthYear ? value : null },
      { column: field.notProvidedColumn, value: isNotProvided },
    );
  }
  return entries;
}

export function candidateOptStatusDataFromRow(row: Record<string, unknown>): CandidateOptStatusData {
  return Object.fromEntries(CANDIDATE_OPT_STATUS_FIELDS.map((field) => {
    if (field.kind === "text") return [field.key, row[field.column] ?? null];
    if (row[field.notProvidedColumn]) return [field.key, CANDIDATE_OPT_STATUS_NOT_PROVIDED];
    if (row[field.monthYearColumn]) return [field.key, String(row[field.monthYearColumn])];
    const value = row[field.column];
    const date = value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
    return [field.key, date];
  })) as CandidateOptStatusData;
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  if (Number(year) < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

function isValidMonthYear(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0;
}

/** Validate the complete editable row before it reaches SQL. */
export function parseCandidateOptStatusData(input: unknown): CandidateOptStatusParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Status data must be an object." };
  }

  const source = input as Record<string, unknown>;
  const allowed = new Set<string>(CANDIDATE_OPT_STATUS_FIELDS.map(({ key }) => key));
  const unknownKey = Object.keys(source).find((key) => !allowed.has(key));
  if (unknownKey) return { ok: false, error: `Unknown status field: ${unknownKey}.` };

  const data = emptyCandidateOptStatusData();
  for (const field of CANDIDATE_OPT_STATUS_FIELDS) {
    const value = source[field.key];
    if (value === undefined || value === null) {
      data[field.key] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { ok: false, error: `${field.label} must be text.` };
    }
    if (field.kind === "date") {
      const dateValue = value.trim();
      if (!dateValue) {
        data[field.key] = null;
        continue;
      }
      if (dateValue.toLocaleLowerCase("en-US") === CANDIDATE_OPT_STATUS_NOT_PROVIDED.toLocaleLowerCase("en-US")) {
        data[field.key] = CANDIDATE_OPT_STATUS_NOT_PROVIDED;
        continue;
      }
      if (isValidMonthYear(dateValue) || isValidIsoDate(dateValue)) {
        data[field.key] = dateValue;
        continue;
      }
      return { ok: false, error: `${field.label} must be a valid date, month and year, or “${CANDIDATE_OPT_STATUS_NOT_PROVIDED}”.` };
    }
    if (value.length > field.maxLength) {
      return { ok: false, error: `${field.label} must be ${field.maxLength.toLocaleString()} characters or fewer.` };
    }
    data[field.key] = value.trim() === "" ? null : value;
  }

  return { ok: true, data };
}
