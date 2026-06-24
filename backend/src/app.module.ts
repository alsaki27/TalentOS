import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AiDigestEntity,
  ApplicationCommentEntity,
  ApplicationEntity,
  ApplicationEventEntity,
  AuditLogEntity,
  CandidateEntity,
  ChatConversationEntity,
  ChatMessageEntity,
  CompanyEntity,
  CompanyPersonEntity,
  ImportProfileEntity,
  ImportRunEntity,
  ImportSourceEntity,
  IntegrationAccountEntity,
  IntegrationEventEntity,
  IntegrationOAuthStateEntity,
  JobCommentEntity,
  JobCrawlerStatusEntity,
  JobEntity,
  OrgInviteEntity,
  OrganizationEntity,
  PlanEntity,
  ProfileEntity,
  PublicApiKeyEntity,
  ResumeEntity,
  SavedJobSearchEntity,
  SubscriptionEntity,
} from "./entities";
import { ApplicationsModule } from "./modules/applications/applications.module";
import { CandidatesModule } from "./modules/candidates/candidates.module";
import { CompaniesModule } from "./modules/companies/companies.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { ProfilesModule } from "./modules/profiles/profiles.module";
import { PublicApiKeysModule } from "./modules/public-api-keys/public-api-keys.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { BillingModule } from "./modules/billing/billing.module";
import { InvitesModule } from "./modules/invites/invites.module";

const entities = [
  AiDigestEntity,
  ApplicationCommentEntity,
  ApplicationEntity,
  ApplicationEventEntity,
  AuditLogEntity,
  CandidateEntity,
  ChatConversationEntity,
  ChatMessageEntity,
  CompanyEntity,
  CompanyPersonEntity,
  ImportProfileEntity,
  ImportRunEntity,
  ImportSourceEntity,
  IntegrationAccountEntity,
  IntegrationEventEntity,
  IntegrationOAuthStateEntity,
  JobCommentEntity,
  JobCrawlerStatusEntity,
  JobEntity,
  OrgInviteEntity,
  OrganizationEntity,
  PlanEntity,
  ProfileEntity,
  PublicApiKeyEntity,
  ResumeEntity,
  SavedJobSearchEntity,
  SubscriptionEntity,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        url: config.getOrThrow<string>("DATABASE_URL"),
        entities,
        synchronize: config.get("TYPEORM_SYNCHRONIZE") === "true",
        ssl: config.get("DATABASE_SSL") === "true" ? { rejectUnauthorized: false } : false,
      }),
    }),
    ProfilesModule,
    CandidatesModule,
    JobsModule,
    ApplicationsModule,
    CompaniesModule,
    PublicApiKeysModule,
    OrganizationsModule,
    BillingModule,
    InvitesModule,
  ],
})
export class AppModule {}
