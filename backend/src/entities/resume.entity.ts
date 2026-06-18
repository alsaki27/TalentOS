import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { CandidateEntity } from "./candidate.entity";

@Entity("resumes")
@Index(["candidateId"])
export class ResumeEntity extends BaseEntity {
  @Column({ name: "candidate_id", type: "uuid" })
  candidateId!: string;

  @ManyToOne(() => CandidateEntity, (candidate) => candidate.resumes, { onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_id" })
  candidate!: CandidateEntity;

  @Column({ type: "text" })
  label!: string;

  @Column({ type: "text", default: "resume" })
  kind!: string;

  @Column({ name: "file_url", type: "text" })
  fileUrl!: string;

  @Column({ type: "text" })
  filename!: string;
}
