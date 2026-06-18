import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { ChatConversationEntity } from "./chat-conversation.entity";

export type ChatMessageRole = "user" | "assistant" | "tool";

@Entity("chat_messages")
@Index(["conversationId", "createdAt"])
export class ChatMessageEntity extends BaseEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  conversationId!: string;

  @ManyToOne(() => ChatConversationEntity, (conversation) => conversation.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: ChatConversationEntity;

  @Column({ type: "text" })
  role!: ChatMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ name: "tool_name", type: "text", nullable: true })
  toolName!: string | null;

  @Column({ name: "attachment_url", type: "text", nullable: true })
  attachmentUrl!: string | null;

  @Column({ name: "attachment_name", type: "text", nullable: true })
  attachmentName!: string | null;

  @Column({ name: "attachment_type", type: "text", nullable: true })
  attachmentType!: string | null;

  @Column({ name: "attachment_text", type: "text", nullable: true })
  attachmentText!: string | null;
}
