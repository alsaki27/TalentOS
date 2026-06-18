import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ApplicationEntity } from "./application.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("application_comments")
@Index(["applicationId", "createdAt"])
@Index(["commenterUserId"])
export class ApplicationCommentEntity extends BaseEntity {
  @Column({ name: "application_id", type: "uuid" })
  applicationId!: string;

  @ManyToOne(() => ApplicationEntity, (application) => application.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "application_id" })
  application!: ApplicationEntity;

  @Column({ name: "commenter_name", type: "text" })
  commenterName!: string;

  @Column({ name: "commenter_user_id", type: "uuid", nullable: true })
  commenterUserId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "commenter_user_id" })
  commenter!: ProfileEntity | null;

  @Column({ type: "text" })
  body!: string;

  @Column({ name: "visible_to_candidate", type: "boolean", default: false })
  visibleToCandidate!: boolean;

  @Column({ name: "parent_comment_id", type: "uuid", nullable: true })
  parentCommentId!: string | null;

  @ManyToOne(() => ApplicationCommentEntity, (comment) => comment.replies, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "parent_comment_id" })
  parentComment!: ApplicationCommentEntity | null;

  @OneToMany(() => ApplicationCommentEntity, (comment) => comment.parentComment)
  replies!: ApplicationCommentEntity[];
}
