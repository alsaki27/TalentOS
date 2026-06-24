import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const candidateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.string().default("active"),
  targetTier: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  resumeUrl: z.string().nullable().optional(),
  resumeFilename: z.string().nullable().optional(),
  targetRoles: z.string().nullable().optional(),
  preferredLocations: z.string().nullable().optional(),
  salaryExpectation: z.string().nullable().optional(),
  workAuthorization: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const updateCandidateSchema = candidateSchema.partial();

export class CreateCandidateDto extends createZodDto(candidateSchema) {}
export class UpdateCandidateDto extends createZodDto(updateCandidateSchema) {}
