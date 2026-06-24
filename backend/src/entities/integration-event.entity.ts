import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "./base.entity";

export type IntegrationEventSeverity = "info" | "success" | "warning" | "error";
export type DeliveryStatus = "received" | "sent" | "failed";

@Entity("integration_events")
@Index(["source", "createdAt"])
@Index(["source", "externalId"])
@Index(["acknowledgedAt", "createdAt"])
export class IntegrationEventEntity extends BaseEntity {
  @Column({ type: "text" })
  source!: string;

  @Column({ name: "event_type", type: "text" })
  eventType!: string;

  @Column({ name: "external_id", type: "text", nullable: true })
  externalId!: string | null;

  @Column({ type: "text", nullable: true })
  title!: string | null;

  @Column({ type: "text", nullable: true })
  message!: string | null;

  @Column({ type: "text", default: "info" })
  severity!: IntegrationEventSeverity;

  @Column({ type: "jsonb", default: {} })
  payload!: Record<string, unknown>;

  @Column({ name: "delivery_status", type: "text", default: "received" })
  deliveryStatus!: DeliveryStatus;

  @Column({ name: "delivery_error", type: "text", nullable: true })
  deliveryError!: string | null;

  @Column({ name: "acknowledged_at", type: "timestamptz", nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ name: "acknowledged_by", type: "text", nullable: true })
  acknowledgedBy!: string | null;

  @Column({ name: "acknowledgement_note", type: "text", nullable: true })
  acknowledgementNote!: string | null;
}
