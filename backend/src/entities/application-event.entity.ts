import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationEntity } from "./application.entity";

@Entity("application_events")
@Index(["applicationId"])
export class ApplicationEventEntity extends BaseEntity {
  @Column({ name: "application_id", type: "uuid" })
  applicationId!: string;

  @ManyToOne(() => ApplicationEntity, (application) => application.events, { onDelete: "CASCADE" })
  @JoinColumn({ name: "application_id" })
  application!: ApplicationEntity;

  @Column({ name: "from_status", type: "text", nullable: true })
  fromStatus!: string | null;

  @Column({ name: "to_status", type: "text" })
  toStatus!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;
}
