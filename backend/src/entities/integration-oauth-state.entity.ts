import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CandidateEntity } from "./candidate.entity";
import { ProfileEntity } from "./profile.entity";

export type IntegrationProvider = "gmail";
export type IntegrationOwnerType = "profile" | "candidate" | "shared_application_mailbox";

@Entity("integration_oauth_states")
@Index(["expiresAt"])
export class IntegrationOAuthStateEntity {
  @PrimaryColumn({ type: "text" })
  state!: string;

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

  @ManyToOne(() => CandidateEntity, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_id" })
  candidate!: CandidateEntity | null;

  @Column({ name: "redirect_after", type: "text", nullable: true })
  redirectAfter!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;
}
