import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { CompanyPersonEntity } from "./company-person.entity";
import { JobEntity } from "./job.entity";

@Entity("companies")
@Index(["normalizedName"], { unique: true })
@Index(["name"])
@Index(["lastSeenAt"])
export class CompanyEntity extends BaseEntity {
  @Column({ type: "text" })
  name!: string;

  @Column({ name: "normalized_name", type: "text" })
  normalizedName!: string;

  @Column({ type: "text", nullable: true })
  slug!: string | null;

  @Column({ type: "text", nullable: true })
  website!: string | null;

  @Column({ name: "linkedin_url", type: "text", nullable: true })
  linkedinUrl!: string | null;

  @Column({ name: "logo_url", type: "text", nullable: true })
  logoUrl!: string | null;

  @Column({ name: "employees_count", type: "integer", nullable: true })
  employeesCount!: number | null;

  @Column({ type: "jsonb", nullable: true })
  address!: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  slogan!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "text", nullable: true })
  source!: string | null;

  @Column({ name: "first_seen_at", type: "timestamptz", nullable: true })
  firstSeenAt!: Date | null;

  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @OneToMany(() => JobEntity, (job) => job.companyProfile)
  jobs!: JobEntity[];

  @OneToMany(() => CompanyPersonEntity, (person) => person.company)
  people!: CompanyPersonEntity[];
}
