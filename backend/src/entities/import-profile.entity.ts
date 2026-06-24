import { Column, Entity } from "typeorm";
import { BaseEntity } from "./base.entity";

@Entity("import_profiles")
export class ImportProfileEntity extends BaseEntity {
  @Column({ type: "text" })
  label!: string;

  @Column({ name: "column_map", type: "jsonb" })
  columnMap!: Record<string, unknown>;
}
