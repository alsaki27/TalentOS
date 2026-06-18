import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const companySchema = z.object({
  name: z.string().min(1),
  website: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  employeesCount: z.number().int().nullable().optional(),
  address: z.record(z.unknown()).nullable().optional(),
  slogan: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

export const companyPersonSchema = z.object({
  fullName: z.string().min(1),
  title: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  influenceLevel: z.enum(["unknown", "recruiter", "hiring_manager", "manager", "executive"]).default("unknown"),
  relationshipStatus: z.enum(["new", "contacted", "replied", "warm", "do_not_contact"]).default("new"),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

export class CreateCompanyDto extends createZodDto(companySchema) {}
export class UpdateCompanyDto extends createZodDto(companySchema.partial()) {}
export class CreateCompanyPersonDto extends createZodDto(companyPersonSchema) {}
export class UpdateCompanyPersonDto extends createZodDto(companyPersonSchema.partial()) {}
