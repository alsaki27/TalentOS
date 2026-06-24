import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const applicationSchema = z.object({
  candidateId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: z.string().default("applied"),
  resumeUrl: z.string().nullable().optional(),
  resumeFilename: z.string().nullable().optional(),
  resumeId: z.string().uuid().nullable().optional(),
  followUpAt: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  assignedBy: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  assignmentNote: z.string().nullable().optional(),
  assignmentDueAt: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  reviewStatus: z.enum(["not_required", "pending", "approved", "changes_requested"]).default("not_required"),
  reviewNote: z.string().nullable().optional(),
});

export const updateApplicationSchema = applicationSchema.partial().omit({ candidateId: true, jobId: true });

export const commentSchema = z.object({
  body: z.string().min(1),
  visibleToCandidate: z.boolean().default(false),
  parentCommentId: z.string().uuid().nullable().optional(),
});

export class CreateApplicationDto extends createZodDto(applicationSchema) {}
export class UpdateApplicationDto extends createZodDto(updateApplicationSchema) {}
export class CreateApplicationCommentDto extends createZodDto(commentSchema) {}
