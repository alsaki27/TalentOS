import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}
