import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationEntity } from "./application.entity";
import { ResumeEntity } from "./resume.entity";
import { IntegrationAccountEntity } from "./integration-account.entity";

@Entity("candidates")
@Index(["portalToken"], { unique: true })
@Index(["status"])
@Index(["targetTier"])
export class CandidateEntity extends BaseEntity {
  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  email!: string | null;

  @Column({ type: "text", nullable: true })
  phone!: string | null;

  @Column({ type: "text", default: "active" })
  status!: string;

  @Column({ name: "target_tier", type: "text", nullable: true })
  targetTier!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "resume_url", type: "text", nullable: true })
  resumeUrl!: string | null;

  @Column({ name: "resume_filename", type: "text", nullable: true })
  resumeFilename!: string | null;

  @Column({ name: "target_roles", type: "text", nullable: true })
  targetRoles!: string | null;

  @Column({ name: "preferred_locations", type: "text", nullable: true })
  preferredLocations!: string | null;

  @Column({ name: "salary_expectation", type: "text", nullable: true })
  salaryExpectation!: string | null;

  @Column({ name: "work_authorization", type: "text", nullable: true })
  workAuthorization!: string | null;

  @Column({ name: "avatar_url", type: "text", nullable: true })
  avatarUrl!: string | null;

  @Column({ name: "portal_token", type: "uuid", generated: "uuid" })
  portalToken!: string;

  @OneToMany(() => ResumeEntity, (resume) => resume.candidate)
  resumes!: ResumeEntity[];

  @OneToMany(() => ApplicationEntity, (application) => application.candidate)
  applications!: ApplicationEntity[];

  @OneToMany(() => IntegrationAccountEntity, (account) => account.candidate)
  integrationAccounts!: IntegrationAccountEntity[];
}
