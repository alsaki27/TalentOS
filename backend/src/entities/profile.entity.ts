import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationEntity } from "./application.entity";
import { AuditLogEntity } from "./audit-log.entity";
import { OrganizationEntity } from "./organization.entity";
import { SavedJobSearchEntity } from "./saved-job-search.entity";

export type UserRole = "admin" | "manager" | "application_engineer" | "recruiter";

@Entity("profiles")
@Index(["clerkUserId"], { unique: true })
@Index(["role"])
@Index(["isActive"])
export class ProfileEntity extends BaseEntity {
  @Column({ name: "clerk_user_id", type: "text" })
  clerkUserId!: string;

  @Column({ type: "text", nullable: true })
  email!: string | null;

  @Column({ name: "display_name", type: "text", default: "" })
  displayName!: string;

  @Column({ type: "text", default: "recruiter" })
  role!: UserRole;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  organizationId!: string | null;

  @ManyToOne(() => OrganizationEntity, (org) => org.members)
  @JoinColumn({ name: "organization_id" })
  organization?: OrganizationEntity | null;

  @OneToMany(() => ApplicationEntity, (application) => application.assignedToUser)
  assignedApplications!: ApplicationEntity[];

  @OneToMany(() => AuditLogEntity, (auditLog) => auditLog.actor)
  auditLogs!: AuditLogEntity[];

  @OneToMany(() => SavedJobSearchEntity, (search) => search.owner)
  savedJobSearches!: SavedJobSearchEntity[];
}
