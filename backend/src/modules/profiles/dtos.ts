import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "manager", "application_engineer", "recruiter"]);

export const createProfileSchema = z.object({
  clerkUserId: z.string().min(3),
  email: z.string().email().nullable().optional(),
  displayName: z.string().min(1),
  role: userRoleSchema.default("recruiter"),
  isActive: z.boolean().default(true),
});

export const updateProfileSchema = createProfileSchema.partial().omit({ clerkUserId: true });

export class CreateProfileDto extends createZodDto(createProfileSchema) {}
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
