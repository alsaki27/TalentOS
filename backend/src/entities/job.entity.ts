import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationEntity } from "./application.entity";
import { CompanyEntity } from "./company.entity";
import { JobCommentEntity } from "./job-comment.entity";

@Entity("jobs")
@Index(["company"])
@Index(["roleTier"])
@Index(["isActive"])
@Index(["externalJobId"])
@Index(["jobCategory"])
@Index(["companyId"])
export class JobEntity extends BaseEntity {
  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text", nullable: true })
  company!: string | null;

  @Column({ name: "company_id", type: "uuid", nullable: true })
  companyId!: string | null;

  @ManyToOne(() => CompanyEntity, (company) => company.jobs, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "company_id" })
  companyProfile!: CompanyEntity | null;

  @Column({ type: "text", nullable: true })
  location!: string | null;

  @Column({ type: "text", nullable: true })
  source!: string | null;

  @Column({ name: "role_tier", type: "text", nullable: true })
  roleTier!: string | null;

  @Column({ name: "salary_range", type: "text", nullable: true })
  salaryRange!: string | null;

  @Column({ name: "source_url", type: "text", nullable: true })
  sourceUrl!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "seniority_level", type: "text", nullable: true })
  seniorityLevel!: string | null;

  @Column({ name: "employment_type", type: "text", nullable: true })
  employmentType!: string | null;

  @Column({ name: "applicants_count", type: "integer", nullable: true })
  applicantsCount!: number | null;

  @Column({ name: "company_employees_count", type: "integer", nullable: true })
  companyEmployeesCount!: number | null;

  @Column({ name: "company_website", type: "text", nullable: true })
  companyWebsite!: string | null;

  @Column({ name: "posted_at", type: "date", nullable: true })
  postedAt!: string | null;

  @Column({ name: "external_job_id", type: "text", nullable: true })
  externalJobId!: string | null;

  @Column({ name: "tracking_id", type: "text", nullable: true })
  trackingId!: string | null;

  @Column({ name: "ref_id", type: "text", nullable: true })
  refId!: string | null;

  @Column({ name: "apply_url", type: "text", nullable: true })
  applyUrl!: string | null;

  @Column({ name: "description_html", type: "text", nullable: true })
  descriptionHtml!: string | null;

  @Column({ name: "description_text", type: "text", nullable: true })
  descriptionText!: string | null;

  @Column({ type: "jsonb", nullable: true })
  benefits!: unknown;

  @Column({ name: "job_function", type: "text", nullable: true })
  jobFunction!: string | null;

  @Column({ type: "text", nullable: true })
  industries!: string | null;

  @Column({ name: "input_url", type: "text", nullable: true })
  inputUrl!: string | null;

  @Column({ name: "company_linkedin_url", type: "text", nullable: true })
  companyLinkedinUrl!: string | null;

  @Column({ name: "company_logo_url", type: "text", nullable: true })
  companyLogoUrl!: string | null;

  @Column({ name: "company_address", type: "jsonb", nullable: true })
  companyAddress!: unknown;

  @Column({ name: "company_slogan", type: "text", nullable: true })
  companySlogan!: string | null;

  @Column({ name: "company_description", type: "text", nullable: true })
  companyDescription!: string | null;

  @Column({ name: "job_poster_name", type: "text", nullable: true })
  jobPosterName!: string | null;

  @Column({ name: "job_poster_title", type: "text", nullable: true })
  jobPosterTitle!: string | null;

  @Column({ name: "job_poster_profile_url", type: "text", nullable: true })
  jobPosterProfileUrl!: string | null;

  @Column({ name: "job_poster_photo_url", type: "text", nullable: true })
  jobPosterPhotoUrl!: string | null;

  @Column({ name: "raw_source_payload", type: "jsonb", nullable: true })
  rawSourcePayload!: unknown;

  @Column({ name: "job_category", type: "text", nullable: true })
  jobCategory!: string | null;

  @Column({ name: "category_tags", type: "text", array: true, default: "{}" })
  categoryTags!: string[];

  @Column({ name: "category_relevance_score", type: "integer", nullable: true })
  categoryRelevanceScore!: number | null;

  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @OneToMany(() => ApplicationEntity, (application) => application.job)
  applications!: ApplicationEntity[];

  @OneToMany(() => JobCommentEntity, (comment) => comment.job)
  comments!: JobCommentEntity[];
}
