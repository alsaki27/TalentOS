import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "./base.entity";

@Entity("ai_digests")
@Index(["generatedAt"])
export class AiDigestEntity extends BaseEntity {
  @Column({ type: "text" })
  content!: string;

  @Column({ type: "text" })
  provider!: string;

  @Column({ name: "generated_at", type: "timestamptz", nullable: true })
  generatedAt!: Date | null;
}
