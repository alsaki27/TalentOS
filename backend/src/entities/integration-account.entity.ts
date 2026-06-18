import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { CandidateEntity } from "./candidate.entity";
import { IntegrationOwnerType, IntegrationProvider } from "./integration-oauth-state.entity";
import { ProfileEntity } from "./profile.entity";

export type IntegrationAccountStatus = "active" | "revoked" | "error";

@Entity("integration_accounts")
@Index(["provider", "ownerType", "ownerUserId", "candidateId"])
export class IntegrationAccountEntity extends BaseEntity {
  @Column({ type: "text" })
  provider!: IntegrationProvider;

  @Column({ name: "owner_type", type: "text" })
  ownerType!: IntegrationOwnerType;

  @Column({ name: "owner_user_id", type: "uuid", nullable: true })
  ownerUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_user_id" })
  owner!: ProfileEntity | null;

  @Column({ name: "candidate_id", type: "uuid", nullable: true })
  candidateId!: string | null;

  @ManyToOne(() => CandidateEntity, (candidate) => candidate.integrationAccounts, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_id" })
  candidate!: CandidateEntity | null;

  @Column({ type: "text", nullable: true })
  email!: string | null;

  @Column({ type: "text", array: true, default: "{}" })
  scopes!: string[];

  @Column({ name: "access_token", type: "text", nullable: true })
  accessToken!: string | null;

  @Column({ name: "refresh_token", type: "text", nullable: true })
  refreshToken!: string | null;

  @Column({ name: "token_expires_at", type: "timestamptz", nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ type: "text", default: "active" })
  status!: IntegrationAccountStatus;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @Column({ name: "last_synced_at", type: "timestamptz", nullable: true })
  lastSyncedAt!: Date | null;
}
