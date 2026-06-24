import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ChatMessageEntity } from "./chat-message.entity";
import { ProfileEntity } from "./profile.entity";

@Entity("chat_conversations")
@Index(["userId", "updatedAt"])
export class ChatConversationEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  @ManyToOne(() => ProfileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user!: ProfileEntity | null;

  @Column({ type: "text", default: "New conversation" })
  title!: string;

  @OneToMany(() => ChatMessageEntity, (message) => message.conversation)
  messages!: ChatMessageEntity[];
}
