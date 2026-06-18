import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Unique } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationCommentEntity } from "./application-comment.entity";
import { ApplicationEventEntity } from "./application-event.entity";
import { CandidateEntity } from "./candidate.entity";
import { JobEntity } from "./job.entity";
import { ProfileEntity } from "./profile.entity";
import { ResumeEntity } from "./resume.entity";

export type ApplicationPriority = "low" | "normal" | "high" | "urgent";
export type ReviewStatus = "not_required" | "pending" | "approved" | "changes_requested";

@Entity("applications")
@Unique(["candidateId", "jobId"])
@Index(["candidateId"])
@Index(["jobId"])
@Index(["status"])
@Index(["followUpAt"])
@Index(["assignedTo"])
@Index(["assignedByUserId"])
@Index(["assignedToUserId"])
@Index(["assignmentDueAt"])
@Index(["priority"])
@Index(["reviewStatus"])
export class ApplicationEntity extends BaseEntity {
  @Column({ name: "candidate_id", type: "uuid" })
  candidateId!: string;

  @ManyToOne(() => CandidateEntity, (candidate) => candidate.applications, { onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_id" })
  candidate!: CandidateEntity;

  @Column({ name: "job_id", type: "uuid" })
  jobId!: string;

  @ManyToOne(() => JobEntity, (job) => job.applications, { onDelete: "CASCADE" })
  @JoinColumn({ name: "job_id" })
  job!: JobEntity;

  @Column({ type: "text", default: "applied" })
  status!: string;

  @Column({ name: "resume_url", type: "text", nullable: true })
  resumeUrl!: string | null;

  @Column({ name: "resume_filename", type: "text", nullable: true })
  resumeFilename!: string | null;

  @Column({ name: "resume_id", type: "uuid", nullable: true })
  resumeId!: string | null;

  @ManyToOne(() => ResumeEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "resume_id" })
  resume!: ResumeEntity | null;

  @Column({ name: "follow_up_at", type: "date", nullable: true })
  followUpAt!: string | null;

  @Column({ name: "next_action", type: "text", nullable: true })
  nextAction!: string | null;

  @Column({ name: "follow_up_source", type: "text", nullable: true })
  followUpSource!: string | null;

  @Column({ name: "follow_up_created_at", type: "timestamptz", nullable: true })
  followUpCreatedAt!: Date | null;

  @Column({ name: "follow_up_completed_at", type: "timestamptz", nullable: true })
  followUpCompletedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "assigned_by", type: "text", nullable: true })
  assignedBy!: string | null;

  @Column({ name: "assigned_to", type: "text", nullable: true })
  assignedTo!: string | null;

  @Column({ name: "assigned_by_user_id", type: "uuid", nullable: true })
  assignedByUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assigned_by_user_id" })
  assignedByUser!: ProfileEntity | null;

  @Column({ name: "assigned_to_user_id", type: "uuid", nullable: true })
  assignedToUserId!: string | null;

  @ManyToOne(() => ProfileEntity, (profile) => profile.assignedApplications, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assigned_to_user_id" })
  assignedToUser!: ProfileEntity | null;

  @Column({ name: "assignment_note", type: "text", nullable: true })
  assignmentNote!: string | null;

  @Column({ name: "assignment_due_at", type: "date", nullable: true })
  assignmentDueAt!: string | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  @Column({ name: "applied_at", type: "timestamptz", nullable: true })
  appliedAt!: Date | null;

  @Column({ type: "text", default: "normal" })
  priority!: ApplicationPriority;

  @Column({ name: "review_status", type: "text", default: "not_required" })
  reviewStatus!: ReviewStatus;

  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote!: string | null;

  @Column({ name: "reviewed_by_user_id", type: "uuid", nullable: true })
  reviewedByUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "reviewed_by_user_id" })
  reviewedByUser!: ProfileEntity | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @OneToMany(() => ApplicationEventEntity, (event) => event.application)
  events!: ApplicationEventEntity[];

  @OneToMany(() => ApplicationCommentEntity, (comment) => comment.application)
  comments!: ApplicationCommentEntity[];
}
