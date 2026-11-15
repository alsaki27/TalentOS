import type { ApplicationInterviewStage, InterviewPreparationFile } from "@/lib/applicationInterviewPreparation";

export interface ApplicationDetailRecord {
  id: string;
  app_number: number | null;
  status: string;
  application_stage: string | null;
  ae_stage: string | null;
  source_type: string | null;
  candidate_name: string;
  candidate_timezone: string | null;
  job_id: string | null;
  job_title: string | null;
  company_name: string | null;
  company_website: string | null;
  location: string | null;
  source_url: string | null;
  job_source: string | null;
  fit_score: number | string | null;
  recommendation: string | null;
  eligibility_restricted: boolean | null;
  requires_citizenship: boolean | null;
  citizenship_countries: string[] | null;
  export_control_restricted: boolean | null;
  eligibility_restriction_evidence: string | null;
  created_at: string | null;
  applied_at: string | null;
  next_action: string | null;
  follow_up_at: string | null;
  notes: string | null;
  tailored_resume_version_id: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  sharepoint_resume_url: string | null;
}

export interface ApplicationActivity {
  id: string;
  kind: "status" | "stage" | "update" | "interview";
  action: string;
  before_value: string | null;
  after_value: string | null;
  detail: string | null;
  actor: string | null;
  created_at: string | null;
  previous_time_zone?: string | null;
  time_zone?: string | null;
}

export interface ApplicationDetailData {
  application: ApplicationDetailRecord;
  stages: ApplicationInterviewStage[];
  files: InterviewPreparationFile[];
  activity: ApplicationActivity[];
}
