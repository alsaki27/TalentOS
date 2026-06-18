import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { CompanyEntity } from "./company.entity";

export type InfluenceLevel = "unknown" | "recruiter" | "hiring_manager" | "manager" | "executive";
export type RelationshipStatus = "new" | "contacted" | "replied" | "warm" | "do_not_contact";

@Entity("company_people")
@Index(["companyId", "lastSeenAt"])
@Index(["linkedinUrl"])
export class CompanyPersonEntity extends BaseEntity {
  @Column({ name: "company_id", type: "uuid" })
  companyId!: string;

  @ManyToOne(() => CompanyEntity, (company) => company.people, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: CompanyEntity;

  @Column({ name: "full_name", type: "text" })
  fullName!: string;

  @Column({ name: "normalized_name", type: "text" })
  normalizedName!: string;

  @Column({ type: "text", nullable: true })
  title!: string | null;

  @Column({ name: "linkedin_url", type: "text", nullable: true })
  linkedinUrl!: string | null;

  @Column({ name: "photo_url", type: "text", nullable: true })
  photoUrl!: string | null;

  @Column({ type: "text", nullable: true })
  email!: string | null;

  @Column({ type: "text", nullable: true })
  phone!: string | null;

  @Column({ name: "influence_level", type: "text", default: "unknown" })
  influenceLevel!: InfluenceLevel;

  @Column({ name: "relationship_status", type: "text", default: "new" })
  relationshipStatus!: RelationshipStatus;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "text", nullable: true })
  source!: string | null;

  @Column({ name: "first_seen_at", type: "timestamptz", nullable: true })
  firstSeenAt!: Date | null;

  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;
}
