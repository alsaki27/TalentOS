export const CANDIDATE_PROFILE_TABS = ["Applications", "Profile Overview", "Submission Records", "Training Audit", "OPT Status", "Custom Interview", "Contract", "Source of Truth", "Evidence Bank", "Base Resumes", "Tailored Resumes", "Notes & Caveats", "Audit"] as const;
export type CandidateProfileTab = typeof CANDIDATE_PROFILE_TABS[number];
export function initialCandidateProfileTab(value: string | null): CandidateProfileTab {
  if (value === "Resume Files") return "Base Resumes";
  return CANDIDATE_PROFILE_TABS.includes(value as CandidateProfileTab) ? value as CandidateProfileTab : "Applications";
}
