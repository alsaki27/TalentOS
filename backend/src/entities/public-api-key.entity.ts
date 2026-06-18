import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("public_api_keys")
@Index(["keyHash"], { unique: true })
@Index(["keyPrefix"])
@Index(["revokedAt"])
export class PublicApiKeyEntity extends BaseEntity {
  @Column({ type: "text" })
  name!: string;

  @Column({ name: "key_prefix", type: "text" })
  keyPrefix!: string;

  @Column({ name: "key_hash", type: "text" })
  keyHash!: string;

  @Column({ type: "text", array: true, default: "{}" })
  scopes!: string[];

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_user_id" })
  createdBy!: ProfileEntity | null;

  @Column({ name: "created_by_email", type: "text", nullable: true })
  createdByEmail!: string | null;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;
}
