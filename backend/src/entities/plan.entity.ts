import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { SubscriptionEntity } from "./subscription.entity";

@Entity("plans")
@Index(["slug"], { unique: true })
export class PlanEntity extends BaseEntity {
  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", unique: true })
  slug!: string;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  priceMonthly!: string;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  priceYearly!: string;

  @Column({ type: "int", default: 1 })
  maxUsers!: number;

  @Column({ type: "int", default: 100 })
  maxCandidates!: number;

  @Column({ type: "int", default: 50 })
  maxJobs!: number;

  @Column({ type: "int", default: 500 })
  maxApplications!: number;

  @Column({ type: "int", default: 100 })
  maxStorageMb!: number;

  @Column({ type: "simple-json", default: "{}" })
  features!: Record<string, boolean>;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;

  @OneToMany(() => SubscriptionEntity, (sub) => sub.plan)
  subscriptions!: SubscriptionEntity[];
}
