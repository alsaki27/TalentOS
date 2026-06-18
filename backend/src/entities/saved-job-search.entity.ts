import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("saved_job_searches")
@Index(["ownerUserId"])
@Index(["isShared", "createdAt"])
export class SavedJobSearchEntity extends BaseEntity {
  @Column({ type: "text" })
  label!: string;

  @Column({ name: "owner_user_id", type: "uuid", nullable: true })
  ownerUserId!: string | null;

  @ManyToOne(() => ProfileEntity, (profile) => profile.savedJobSearches, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "owner_user_id" })
  owner!: ProfileEntity | null;

  @Column({ type: "jsonb", default: {} })
  filters!: Record<string, unknown>;

  @Column({ name: "is_shared", type: "boolean", default: true })
  isShared!: boolean;
}
