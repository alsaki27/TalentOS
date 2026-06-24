import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { OrganizationEntity } from "./organization.entity";

@Entity("org_invites")
@Index(["token"], { unique: true })
export class OrgInviteEntity extends BaseEntity {
  @Column({ type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, (org) => org.invites)
  @JoinColumn({ name: "organization_id" })
  organization!: OrganizationEntity;

  @Column({ type: "text" })
  email!: string;

  @Column({ type: "text", default: "recruiter" })
  role!: "admin" | "manager" | "application_engineer" | "recruiter";

  @Column({ type: "text" })
  token!: string;

  @Column({ type: "uuid", nullable: true })
  invitedById?: string | null;

  @Column({ type: "uuid", nullable: true })
  acceptedById?: string | null;

  @Column({ type: "text", default: "pending" })
  status!: "pending" | "accepted" | "expired" | "revoked";

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  acceptedAt?: Date | null;
}
