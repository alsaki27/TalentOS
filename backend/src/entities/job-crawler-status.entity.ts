import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "./base.entity";

@Entity("job_crawler_status")
@Index(["crawlerName"], { unique: true })
export class JobCrawlerStatusEntity extends BaseEntity {
  @Column({ name: "crawler_name", type: "text" })
  crawlerName!: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "last_heartbeat_at", type: "timestamptz", nullable: true })
  lastHeartbeatAt!: Date | null;

  @Column({ name: "offline_threshold_minutes", type: "integer", default: 10 })
  offlineThresholdMinutes!: number;

  @Column({ type: "text", nullable: true })
  message!: string | null;
}
