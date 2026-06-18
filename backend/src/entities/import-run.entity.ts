import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ImportSourceEntity } from "./import-source.entity";

@Entity("import_runs")
@Index(["importSourceId", "ranAt"])
export class ImportRunEntity extends BaseEntity {
  @Column({ name: "import_source_id", type: "uuid" })
  importSourceId!: string;

  @ManyToOne(() => ImportSourceEntity, (source) => source.runs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "import_source_id" })
  importSource!: ImportSourceEntity;

  @Column({ type: "integer", nullable: true })
  imported!: number | null;

  @Column({ type: "integer", nullable: true })
  skipped!: number | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ name: "ran_at", type: "timestamptz", nullable: true })
  ranAt!: Date | null;
}
