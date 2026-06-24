import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { OrganizationEntity } from "./organization.entity";
import { PlanEntity } from "./plan.entity";

@Entity("subscriptions")
@Index(["organizationId"], { unique: true })
export class SubscriptionEntity extends BaseEntity {
  @Column({ type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, (org) => org.subscriptions)
  @JoinColumn({ name: "organization_id" })
  organization!: OrganizationEntity;

  @Column({ type: "uuid" })
  planId!: string;

  @ManyToOne(() => PlanEntity, (plan) => plan.subscriptions)
  @JoinColumn({ name: "plan_id" })
  plan!: PlanEntity;

  @Column({ type: "text", default: "trialing" })
  status!: "trialing" | "active" | "past_due" | "canceled" | "paused";

  @Column({ type: "timestamptz", nullable: true })
  currentPeriodStart?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  currentPeriodEnd?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  trialStart?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  trialEnd?: Date | null;

  @Column({ type: "boolean", default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  canceledAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  endedAt?: Date | null;
}
