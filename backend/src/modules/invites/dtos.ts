import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "manager", "application_engineer", "recruiter"]).default("recruiter"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
});

export class CreateInviteDto extends createZodDto(createInviteSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
