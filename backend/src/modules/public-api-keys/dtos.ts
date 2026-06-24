import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const publicApiScopes = [
  "candidates:read",
  "candidates:write",
  "candidates:delete",
  "jobs:read",
  "jobs:write",
  "jobs:delete",
  "jobs:import",
  "jobs:shortlist",
  "applications:read",
  "applications:write",
  "applications:assign",
  "applications:status",
  "applications:comment",
  "companies:read",
  "companies:write",
  "companies:delete",
  "company_people:read",
  "company_people:write",
  "company_people:delete",
  "events:read",
  "events:write",
  "events:acknowledge",
  "reminders:read",
  "reminders:write",
  "analytics:read",
  "integrations:gmail:read",
  "integrations:gmail:write",
  "integrations:teams:write",
  "api_keys:manage",
] as const;

export const createPublicApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(publicApiScopes)).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export class CreatePublicApiKeyDto extends createZodDto(createPublicApiKeySchema) {}
