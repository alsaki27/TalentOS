import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const createPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  priceMonthly: z.string().nullable().optional(),
  priceYearly: z.string().nullable().optional(),
  maxUsers: z.number().int().default(1),
  maxCandidates: z.number().int().default(100),
  maxJobs: z.number().int().default(50),
  maxApplications: z.number().int().default(500),
  maxStorageMb: z.number().int().default(100),
  features: z.record(z.boolean()).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const updatePlanSchema = createPlanSchema.partial();

export const createSubscriptionSchema = z.object({
  planId: z.string().min(1),
  organizationId: z.string().min(1),
  status: z.enum(["trialing", "active", "past_due", "canceled", "paused"]).default("trialing"),
});

export const updateSubscriptionSchema = z.object({
  status: z.enum(["trialing", "active", "past_due", "canceled", "paused"]).optional(),
  planId: z.string().optional(),
}).partial();

export class CreatePlanDto extends createZodDto(createPlanSchema) {}
export class UpdatePlanDto extends createZodDto(updatePlanSchema) {}
export class CreateSubscriptionDto extends createZodDto(createSubscriptionSchema) {}
export class UpdateSubscriptionDto extends createZodDto(updateSubscriptionSchema) {}
