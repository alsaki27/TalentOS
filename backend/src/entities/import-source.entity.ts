import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ImportRunEntity } from "./import-run.entity";

export type ImportProvider = "greenhouse" | "lever" | "ashby" | "usajobs" | "career_page";

@Entity("import_sources")
@Index(["isActive"])
export class ImportSourceEntity extends BaseEntity {
  @Column({ type: "text" })
  label!: string;

  @Column({ type: "text" })
  provider!: ImportProvider;

  @Column({ name: "token_or_url", type: "text" })
  tokenOrUrl!: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "last_run_at", type: "timestamptz", nullable: true })
  lastRunAt!: Date | null;

  @Column({ name: "last_result", type: "jsonb", nullable: true })
  lastResult!: Record<string, unknown> | null;

  @OneToMany(() => ImportRunEntity, (run) => run.importSource)
  runs!: ImportRunEntity[];
}
