import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("audit_logs")
@Index(["actorUserId", "createdAt"])
@Index(["entityType", "entityId", "createdAt"])
export class AuditLogEntity extends BaseEntity {
  @Column({ name: "actor_user_id", type: "uuid", nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => ProfileEntity, (profile) => profile.auditLogs, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_user_id" })
  actor!: ProfileEntity | null;

  @Column({ name: "actor_email", type: "text", nullable: true })
  actorEmail!: string | null;

  @Column({ type: "text" })
  action!: string;

  @Column({ name: "entity_type", type: "text" })
  entityType!: string;

  @Column({ name: "entity_id", type: "uuid", nullable: true })
  entityId!: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;
}
