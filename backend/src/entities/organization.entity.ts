import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { OrgInviteEntity } from "./org-invite.entity";
import { ProfileEntity } from "./profile.entity";
import { SubscriptionEntity } from "./subscription.entity";

@Entity("organizations")
@Index(["slug"], { unique: true })
export class OrganizationEntity extends BaseEntity {
  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", unique: true })
  slug!: string;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "text", nullable: true })
  website?: string | null;

  @Column({ type: "text", default: "active" })
  status!: "active" | "suspended" | "cancelled";

  @Column({ type: "text", nullable: true })
  billingEmail?: string | null;

  @Column({ type: "text", nullable: true })
  stripeCustomerId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  trialEndsAt?: Date | null;

  @Column({ type: "text", default: "free" })
  planSlug!: string;

  @OneToMany(() => ProfileEntity, (profile) => profile.organization)
  members!: ProfileEntity[];

  @OneToMany(() => OrgInviteEntity, (invite) => invite.organization)
  invites!: OrgInviteEntity[];

  @OneToMany(() => SubscriptionEntity, (sub) => sub.organization)
  subscriptions!: SubscriptionEntity[];
}
