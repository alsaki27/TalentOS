import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const jobSchema = z.object({
  title: z.string().min(1),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  roleTier: z.string().nullable().optional(),
  salaryRange: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  seniorityLevel: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  applicantsCount: z.number().int().nullable().optional(),
  companyEmployeesCount: z.number().int().nullable().optional(),
  companyWebsite: z.string().nullable().optional(),
  postedAt: z.string().nullable().optional(),
  externalJobId: z.string().nullable().optional(),
  applyUrl: z.string().nullable().optional(),
  descriptionText: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  jobFunction: z.string().nullable().optional(),
  industries: z.string().nullable().optional(),
  companyLinkedinUrl: z.string().nullable().optional(),
  companyLogoUrl: z.string().nullable().optional(),
  companyDescription: z.string().nullable().optional(),
  jobPosterName: z.string().nullable().optional(),
  jobPosterTitle: z.string().nullable().optional(),
  jobPosterProfileUrl: z.string().nullable().optional(),
  jobPosterPhotoUrl: z.string().nullable().optional(),
});

export const updateJobSchema = jobSchema.partial();

export class CreateJobDto extends createZodDto(jobSchema) {}
export class UpdateJobDto extends createZodDto(updateJobSchema) {}
