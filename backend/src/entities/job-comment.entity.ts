import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { JobEntity } from "./job.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("job_comments")
@Index(["jobId", "createdAt"])
@Index(["commenterUserId"])
export class JobCommentEntity extends BaseEntity {
  @Column({ name: "job_id", type: "uuid" })
  jobId!: string;

  @ManyToOne(() => JobEntity, (job) => job.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "job_id" })
  job!: JobEntity;

  @Column({ name: "commenter_name", type: "text" })
  commenterName!: string;

  @Column({ name: "commenter_user_id", type: "uuid", nullable: true })
  commenterUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "commenter_user_id" })
  commenter!: ProfileEntity | null;

  @Column({ type: "text" })
  body!: string;
}
