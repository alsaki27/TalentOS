# Graph Report - C:/Users/aasak/Documents/Claude/TalentOS  (2026-07-10)

## Corpus Check
- Large corpus: 622 files � ~350,109 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 3489 nodes · 8991 edges · 225 communities (160 shown, 65 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.84)
- Token cost: 438,074 input · 0 output

## Community Hubs (Navigation)
- Entities (0)
- Api (1)
- Components Ui (2)
- Api Public
- Modules Jobs
- Api (5)
- Entities (6)
- Modules Applications
- Server Auth
- Server Storage
- Api (10)
- Components Falood Resumify (11)
- Lib (12)
- Api (13)
- Api (14)
- Lib Normalizer
- Components (16)
- Candidates [id]
- Invites Module
- Billing Module
- Public Api Keys Module
- Lib Ai (21)
- Falood Studio Application
- Organizations Module
- Components Falood Resumify (24)
- Applicationkeywordsrepository Module
- Docs (26)
- Lib Ai (27)
- Server Repositories
- Components Falood Resumify (29)
- Profiles Module
- Resumeparsing Module
- Package Module (32)
- Api (33)
- Tsconfig Module (34)
- Applicationresumeversionsrepository Module
- Use Toast Module
- Server Services
- Aikeyrepository Module
- Candidates Module
- Applicationpacketaiservice Module
- Applicationresumesuggestionsrepository Module
- Lib Ai (42)
- Seedfromparsedresume Module
- Resumeexportservice Module
- Api Base Resumes
- Jobs
- Resumeeditorcommands Module
- Package Module (48)
- Neon Cloudflare Audit Module (49)
- Interviews [id]
- Components (51)
- Lib Falood (52)
- Jobdedup Module
- Neon Data Migration Plan Module
- Import
- Lib (56)
- Companies Module
- Docs (58)
- Public Api Module
- Lib Integrations
- Neon Cloudflare Audit Module (61)
- Migration Neon Cloudflare Module
- Applicationsrepository Module
- Dropdown Menu Module
- Command Module
- Tsconfig Module (66)
- Components Module
- Deployment Readiness Module
- Package Module (69)
- Jobsrepository Module
- Ops
- Roadmap Module
- Lib Falood (73)
- Review
- Handover Module
- Storage Hybrid Architecture Module
- Package Module (77)
- Mixed Cross-Cutting Cluster (78)
- Neon Cloudflare Audit Module (79)
- Emailservice Module
- Jdanalyzer Module
- Clientexport Module
- Package Module (83)
- Chat Conversation Module
- Cloudflare Diagnostic And Pdf Strategy Module
- Package Module (86)
- Jobcategorization Module
- Lib (88)
- .github Workflows
- Atsscoring Module
- Messagethread Module
- Menubar Module
- Package Module (93)
- Services
- Mixed Cross-Cutting Cluster (95)
- Seed Admin Module (96)
- Setup Check Module
- Services Google Vertex Proxy
- Api Users
- Googlegmail Module
- Sharepoint Module
- Candidates [id] Applications
- Components Ui (103)
- Cloudflare Known Limitations Module
- Communications Sequences
- Companies [id]
- Interviews
- Context Menu Module
- Package Module (109)
- Plan Ai Provider Routing And Grammarly Editing Module
- Teams Module
- Ats Score
- Candidates
- Onboarding
- Inlinediffeditor Module
- Table Module
- Company Person Module
- Application Queue
- Communications Templates
- Interviews Schedule
- Portal [token]
- Select Module
- Tsconfig Module (123)
- Api Falood Applications
- Follow Ups
- Apply Schema Module
- Plan Module
- Find Unconditional Supabase Module
- Find Unconditional Supabase V2 Module
- Communications Logs
- Import Sources
- Ai Task Routing Module
- Activityfeed Module
- Interviewcard Module
- .eslintrc Module
- Seed Admin Module (136)
- Services Render Keepalive Worker
- Notifications
- Ai Key Manager Module
- Settings Api Keys
- Settings Webhooks
- Docxexport Module
- Nest Cli Module
- Fix Schema Module
- Mixed Cross-Cutting Cluster (145)
- Main Module
- Account
- Api Cron Email Queue
- Falood
- Login
- Neon Cloudflare Audit Module (151)
- Fix Fonts Inline Module
- Fix Fonts Inline2 Module
- Api Falood Extract Skills
- Api Falood Suggestions
- Communications (157)
- Companies
- Interviews Scorecards
- Test Neon Module
- Package Module (161)
- Package Module (162)
- Package Module (163)
- Package Module (164)
- Package Module (165)
- Package Module (166)
- Package Module (167)
- Package Module (168)
- Package Module (169)
- Package Module (170)
- Package Module (171)
- Package Module (172)
- Neon Cloudflare Audit Module (173)
- Neon Cloudflare Audit Module (174)
- Package Module (175)
- Package Module (176)
- Package Module (177)
- Package Module (178)
- Next.config Module
- Package Module (180)
- Package Module (181)
- Package Module (182)
- Package Module (183)
- Package Module (184)
- Package Module (185)
- Package Module (186)
- Package Module (187)
- Package Module (188)
- Package Module (189)
- Package Module (190)
- Package Module (191)
- Package Module (192)
- Package Module (193)
- Package Module (194)
- Package Module (195)
- Package Module (196)
- Package Module (197)
- Package Module (198)
- Package Module (199)
- Package Module (200)
- Package Module (201)
- Package Module (202)
- Package Module (203)
- Package Module (204)
- Package Module (205)
- Package Module (206)
- Package Module (207)
- Package Module (208)
- Package Module (209)
- Package Module (210)
- Package Module (211)
- Vercel Module

## God Nodes (most connected - your core abstractions)
1. `isNeon()` - 495 edges
2. `requireCurrentUser()` - 302 edges
3. `queryOne()` - 225 edges
4. `query()` - 209 edges
5. `execute()` - 175 edges
6. `logActivity()` - 129 edges
7. `cn()` - 84 edges
8. `supabase` - 77 edges
9. `CurrentUser` - 67 edges
10. `requirePublicApiScope()` - 67 edges

## Surprising Connections (you probably didn't know these)
- `Skarion etl Module Comparison (my-applications/my-stats)` --semantically_similar_to--> `getCurrentUserContext()`  [INFERRED] [semantically similar]
  docs/candidate-self-login.md → src/lib/auth.ts
- `Authenticated Request Flow` --references--> `getCurrentUserContext()`  [EXTRACTED]
  docs/auth-hybrid-architecture.md → src/lib/auth.ts
- `Decision: Keep src/lib/supabase.ts Interface (Proxy Pattern)` --references--> `supabase`  [EXTRACTED]
  docs/neon-cloudflare-audit.md → src/lib/supabase.ts
- `File Upload Flow` --references--> `supabase`  [EXTRACTED]
  docs/storage-hybrid-architecture.md → src/lib/supabase.ts
- `Decision 3: Session Handling Separate from middleware.ts` --references--> `middleware()`  [EXTRACTED]
  docs/candidate-self-login.md → src/middleware.ts

## Import Cycles
- 3-file cycle: `backend/src/entities/candidate.entity.ts -> backend/src/entities/integration-account.entity.ts -> backend/src/entities/integration-oauth-state.entity.ts -> backend/src/entities/candidate.entity.ts`

## Hyperedges (group relationships)
- **Handover Documentation Reading Order** — handover_document, status_report_document, readme_document, roadmap_document [EXTRACTED 1.00]
- **Neon + Cloudflare Migration Effort** — plan_document, handover_migrationsprint, status_report_neoncloudflaremigrationsprint, roadmap_neoncloudflaremigrationprogress [INFERRED 0.90]
- **Application Workflow Redesign Chunks 1-3** — plan_application_workflow_redesign_document, status_report_chunk1applicationworkflowfoundation, status_report_chunk2jdanalyzer, status_report_chunk3autocreatejob [INFERRED 0.85]
- **Node.js-Only APIs Incompatible with Cloudflare Workers** — docs_neon_cloudflare_audit_node_only_runtime_api_audit, docs_neon_cloudflare_audit_crypto_module_critical, docs_neon_cloudflare_audit_docx_package_critical, docs_neon_cloudflare_audit_react_pdf_renderer_critical, docs_neon_cloudflare_audit_pdf_parse_mammoth_critical, docs_neon_cloudflare_audit_buffer_usage_moderate [EXTRACTED 1.00]
- **Hybrid Option A: Neon DB + Supabase Auth/Storage Docs** — docs_neon_cloudflare_audit_executive_summary_hybrid_option_a, docs_auth_hybrid_architecture_auth_hybrid_architecture, docs_storage_hybrid_architecture_storage_hybrid_architecture, docs_migration_neon_cloudflare_migration_readiness_neon_cloudflare [INFERRED 0.90]
- **Supabase-to-Neon Migration Runbook Document Set** — docs_neon_data_migration_plan_data_migration_plan, docs_supabase_to_neon_data_migration_data_migration_supabase_neon, docs_neon_migration_plan_neon_migration_plan, docs_neon_safe_migration_runbook_neon_safe_migration_runbook [INFERRED 0.85]

## Communities (225 total, 65 thin omitted)

### Community 0 - "Entities (0)"
Cohesion: 0.04
Nodes (88): InjectRepository, ApplicationEntity, ApplicationPriority, ReviewStatus, Column, Entity, Index, JoinColumn (+80 more)

### Community 1 - "Api (1)"
Cohesion: 0.05
Nodes (79): DELETE(), GET(), PATCH(), GET(), POST(), POST(), findApplicationId(), GET() (+71 more)

### Community 2 - "Components Ui (2)"
Cohesion: 0.03
Nodes (82): BillingPage(), Plan, plans, usage, DropZone(), DropZoneProps, ImportStepIndicator(), ImportStepIndicatorProps (+74 more)

### Community 3 - "Api Public"
Cohesion: 0.06
Nodes (72): GET(), POST(), GET(), GET(), PATCH(), GET(), GET(), rate() (+64 more)

### Community 4 - "Modules Jobs"
Cohesion: 0.06
Nodes (43): AuthorizationService, DESTRUCTIVE_ROLES, MASTER_DATA_ROLES, Injectable, ClerkAuthGuard, Injectable, CurrentUser, normalizeCompanyName() (+35 more)

### Community 5 - "Api (5)"
Cohesion: 0.06
Nodes (42): GET(), PUT(), GET(), GET(), rate(), GET(), SOURCE_ORDER, EXPORT_TYPES (+34 more)

### Community 6 - "Entities (6)"
Cohesion: 0.04
Nodes (56): AppModule, entities, Module, AiDigestEntity, Column, Entity, Index, ImportProfileEntity (+48 more)

### Community 7 - "Modules Applications"
Cohesion: 0.06
Nodes (40): ASSIGNMENT_MANAGER_ROLES, addDays(), applicationAutomation(), ApplicationAutomationInput, ApplicationAutomationResult, schedule(), ApplicationCommentEntity, Column (+32 more)

### Community 8 - "Server Auth"
Cohesion: 0.08
Nodes (46): GET(), GET(), POST(), POST(), POST(), ToolContext, ALL_USER_ROLES, canAccessPath() (+38 more)

### Community 9 - "Server Storage"
Cohesion: 0.08
Nodes (43): POST(), isTextFile(), POST(), TEXT_EXTENSIONS, GET(), isAuthorized(), GET(), GET() (+35 more)

### Community 10 - "Api (10)"
Cohesion: 0.06
Nodes (37): applyMigration(), run(), backfill(), openai, run(), DELETE(), POST(), DELETE() (+29 more)

### Community 11 - "Components Falood Resumify (11)"
Cohesion: 0.15
Nodes (32): SavedApplication, ResumeFormProps, ColorCustomizer(), CustomSectionsForm(), EducationForm(), ExperienceForm(), PersonalInfoForm(), ProjectsForm() (+24 more)

### Community 12 - "Lib (12)"
Cohesion: 0.10
Nodes (35): GET(), POST(), POST(), PATCH(), POST(), PATCH(), POST(), PROVIDERS (+27 more)

### Community 13 - "Api (13)"
Cohesion: 0.07
Nodes (34): GET(), POST(), GET(), GET(), GET(), GET(), GET(), DELETE() (+26 more)

### Community 14 - "Api (14)"
Cohesion: 0.09
Nodes (32): GET(), POST(), DELETE(), PATCH(), GET(), POST(), PATCH(), GET() (+24 more)

### Community 15 - "Lib Normalizer"
Cohesion: 0.09
Nodes (37): headerOverlapScore(), ImportProfile, normalizeHeader(), POST(), chunkArray(), findExistingUrls(), POST(), CleanedJobRow (+29 more)

### Community 16 - "Components (16)"
Cohesion: 0.05
Nodes (29): AuthGate(), isPublicPath(), ChatMessage, ConversationSummary, WidgetMessage, metadata, MeResponse, Notifications (+21 more)

### Community 17 - "Candidates [id]"
Cohesion: 0.05
Nodes (25): Application, ApplicationComment, ApplicationEvent, BaseResumeSummary, CandidateDetail, CandidateProfilePage(), Evidence, initials() (+17 more)

### Community 18 - "Invites Module"
Cohesion: 0.07
Nodes (28): OrgInviteEntity, Column, Entity, Index, JoinColumn, ManyToOne, AcceptInviteDto, acceptInviteSchema (+20 more)

### Community 19 - "Billing Module"
Cohesion: 0.09
Nodes (23): BillingController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+15 more)

### Community 20 - "Public Api Keys Module"
Cohesion: 0.07
Nodes (31): AuditLogEntity, Column, Entity, Index, JoinColumn, ManyToOne, PublicApiKeyEntity, Column (+23 more)

### Community 21 - "Lib Ai (21)"
Cohesion: 0.09
Nodes (32): POST(), getGoogleFallbackProvider(), toGeminiContent(), toGeminiMessages(), callVertexProxy(), fromGeminiParts(), GeminiContent, GeminiFunctionCallPart (+24 more)

### Community 22 - "Falood Studio Application"
Cohesion: 0.06
Nodes (32): ApplicationPacketRow, ApplicationResumeStudioPage(), ApplicationResumeVersion, BaseResume, Candidate, estimatePages(), FaloodAction, KeywordApproval (+24 more)

### Community 23 - "Organizations Module"
Cohesion: 0.10
Nodes (18): CreateOrganizationDto, createOrganizationSchema, UpdateOrganizationDto, updateOrganizationSchema, OrganizationsController, ApiBearerAuth, ApiOperation, ApiTags (+10 more)

### Community 24 - "Components Falood Resumify (24)"
Cohesion: 0.11
Nodes (26): react, react, ResumeContent(), buildCustomSectionsForBuilder(), convertOldFormatToNew(), projectBulletsToText(), reportBaseResumeDebug(), ResumeContent() (+18 more)

### Community 25 - "Applicationkeywordsrepository Module"
Cohesion: 0.11
Nodes (30): POST(), ApplicationKeywordCategory, ApplicationKeywordEvidenceStatus, ApplicationKeywordImportance, ApplicationKeywordSource, ApplicationKeywordStatus, BulkUpdateInput, countApplicationKeywordsByStatus() (+22 more)

### Community 26 - "Docs (26)"
Cohesion: 0.07
Nodes (33): TalentOS Auth Hybrid Architecture, Authenticated Request Flow, JWT Validation Security, Login Flow, Migration Option 1: Keep Supabase Auth Permanently, Migration Option 2: Custom Auth with Neon, Service Role Key Security, Candidate Self-Login Dashboard Design Doc (+25 more)

### Community 27 - "Lib Ai (27)"
Cohesion: 0.17
Nodes (23): POST(), getAnthropicProvider(), getGlmProvider(), getGoogleProvider(), getGoogleVertexProxyProvider(), ActiveProvider, AI_TASK_CATEGORIES, AiTaskCategory (+15 more)

### Community 28 - "Server Repositories"
Cohesion: 0.13
Nodes (27): POST(), POST(), POST(), GET(), PACKET_VIEWER_ROLES, PATCH(), POST(), GET() (+19 more)

### Community 29 - "Components Falood Resumify (29)"
Cohesion: 0.11
Nodes (25): BJetProfessionalTemplate(), TemplateProps, BusinessProfessionalTemplate(), TemplateProps, CreativeModernTemplate(), TemplateProps, ElegantTimelineTemplate(), TemplateProps (+17 more)

### Community 30 - "Profiles Module"
Cohesion: 0.09
Nodes (21): CreateProfileDto, createProfileSchema, UpdateProfileDto, updateProfileSchema, userRoleSchema, ProfilesController, ApiBearerAuth, ApiOperation (+13 more)

### Community 31 - "Resumeparsing Module"
Cohesion: 0.15
Nodes (31): cleanExtractedUrl(), cleanSkillLine(), COMMON_RESUME_SECTION_TITLES, extractCategorizedSkillsFromRawText(), extractLinkedInUrl(), extractSkillsSectionLines(), extractTextFromPdfBuffer(), extractTextShowOperators() (+23 more)

### Community 32 - "Package Module (32)"
Cohesion: 0.06
Nodes (31): class-variance-authority, docx, lucide-react, @neondatabase/serverless, dependencies, class-variance-authority, docx, lucide-react (+23 more)

### Community 33 - "Api (33)"
Cohesion: 0.10
Nodes (21): GET(), POST(), DELETE(), GET(), PATCH(), GET(), PATCH(), POST() (+13 more)

### Community 34 - "Tsconfig Module (34)"
Cohesion: 0.07
Nodes (29): backend, dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, ./src/* (+21 more)

### Community 35 - "Applicationresumeversionsrepository Module"
Cohesion: 0.11
Nodes (28): ApplicationResumeVersionRow, attachResumeVersionToPacket(), cloneResumeVersion(), createApplicationResumeVersion(), CreateApplicationResumeVersionInput, createOrUpdatePacket(), deleteResumeVersion(), getCurrentDraftForApplication() (+20 more)

### Community 36 - "Use Toast Module"
Cohesion: 0.12
Nodes (24): Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, ToastTitle, toastVariants (+16 more)

### Community 37 - "Server Services"
Cohesion: 0.12
Nodes (25): createManySuggestions(), CreateSuggestionInput, SuggestionTargetSection, SuggestionTruthStatus, BaseResumeData, buildResumeContext(), EvidenceBankItem, findEvidenceForKeyword() (+17 more)

### Community 38 - "Aikeyrepository Module"
Cohesion: 0.15
Nodes (23): DELETE(), PATCH(), GET(), POST(), AiApiKeyMetadata, AiApiKeyRow, AiKeyStatus, AiProvider (+15 more)

### Community 39 - "Candidates Module"
Cohesion: 0.12
Nodes (16): CandidatesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Delete, Get (+8 more)

### Community 40 - "Applicationpacketaiservice Module"
Cohesion: 0.15
Nodes (24): POST(), ApplicationKeywordRow, listApplicationKeywords(), ApplicationResumeSuggestionRow, findCandidateById(), findJobById(), findTargetJobByCandidateAndJob(), buildCoverLetterPrompt() (+16 more)

### Community 41 - "Applicationresumesuggestionsrepository Module"
Cohesion: 0.12
Nodes (20): POST(), GET(), POST(), PATCH(), createSuggestion(), deleteSuggestion(), deleteSuggestionsByApplicationId(), findSuggestionById() (+12 more)

### Community 42 - "Lib Ai (42)"
Cohesion: 0.16
Nodes (22): gatherSnapshot(), generateDailyDigest(), buildSuggestPrompt(), gatherContext(), generateResumeSuggestions(), runApplicationTailoringCommand(), TailoringContext, buildPrompt() (+14 more)

### Community 43 - "Seedfromparsedresume Module"
Cohesion: 0.22
Nodes (24): asRecord(), asTrimmedString(), buildBulletsFromUnknown(), buildResumeDocumentFromParsedResume(), CandidateSeedInfo, FRAGMENT_CATEGORY_TITLES, humanizeKey(), isValidCategoryTitle() (+16 more)

### Community 44 - "Resumeexportservice Module"
Cohesion: 0.22
Nodes (20): findApplicationId(), POST(), GET(), POST(), ApplicationResumeExportRow, createExport(), findExportById(), markExportFailed() (+12 more)

### Community 45 - "Api Base Resumes"
Cohesion: 0.19
Nodes (19): guessMimeType(), loadLatestUploadedResume(), logBaseResumeCreateConsole(), parseUploadedResumeForBaseSeeding(), POST(), reportBaseResumeSeedingDebug(), reportLinkedinUrlSeedingDebug(), scanBufferForLinkedInUrls() (+11 more)

### Community 46 - "Jobs"
Cohesion: 0.09
Nodes (16): AnalyzeResult, Applicant, FieldMapping, initials(), Job, JobsPage(), MatchingProfile, MatchScore (+8 more)

### Community 47 - "Resumeeditorcommands Module"
Cohesion: 0.19
Nodes (21): highlightJSON(), ResumeCliEditor(), addCertification(), addCustomSection(), addEducation(), addExperience(), addProject(), addSkillSection() (+13 more)

### Community 48 - "Package Module (48)"
Cohesion: 0.09
Nodes (23): autoprefixer, eslint, eslint-config-next, @opennextjs/cloudflare, devDependencies, autoprefixer, eslint, eslint-config-next (+15 more)

### Community 49 - "Neon Cloudflare Audit Module (49)"
Cohesion: 0.12
Nodes (23): Abstraction Layer Table (DB/Auth/Storage/Realtime/Cron), Buffer Usage (global) — Moderate, crypto Module (Node.js) — Critical, docx Package — Critical, Files That Must Change (Complete List), Node-Only Runtime API Audit, pdf-parse + mammoth — Critical, @react-pdf/renderer — Critical (+15 more)

### Community 50 - "Interviews [id]"
Cohesion: 0.10
Nodes (18): initials(), InterviewDetail, InterviewDetailPage(), MeResponse, PanelMember, Profile, Scorecard, statusBadgeClass() (+10 more)

### Community 51 - "Components (51)"
Cohesion: 0.10
Nodes (9): AnalyticsPage(), getDateRange(), BarChartProps, BarData, DEFAULT_COLORS, DEFAULT_COLORS, PieChartProps, PieData (+1 more)

### Community 52 - "Lib Falood (52)"
Cohesion: 0.13
Nodes (16): ArrayDiffSection(), compareJSON(), diffArray(), DiffStatus, Props, ResumeDiffViewer(), CertificationBlock, EducationBlock (+8 more)

### Community 53 - "Jobdedup Module"
Cohesion: 0.16
Nodes (19): DedupeCandidate, DuplicateCheckInput, DuplicateCheckResult, enrichExistingJobsBySourceUrl(), fieldMatches(), filterNewJobsWithFuzzyFallback(), fuzzyJobMatch(), jobDuplicateSignature() (+11 more)

### Community 54 - "Neon Data Migration Plan Module"
Cohesion: 0.13
Nodes (20): Mitigation: Disabling PDF/DOCX Export via Feature Flag, Migration Status Phase Table (Phase 1-14), Step 3: Clean the Export, Step 6: Switch to Neon (Cutover), TalentOS Data Migration Plan: Supabase to Neon, DB_PROVIDER Switch (neon/supabase), Step 2: Export Data from Supabase (pg_dump), Step 4: Import Data into Neon (+12 more)

### Community 55 - "Import"
Cohesion: 0.10
Nodes (12): AnalyzeResponse, FieldMapping, ImportResult, MatchingProfile, SchemaField, SOURCE_CARDS, SourceType, STEPS (+4 more)

### Community 56 - "Lib (56)"
Cohesion: 0.16
Nodes (17): fetchAshbyJobs(), fetchAtsJobs(), fetchGreenhouseJobs(), fetchLeverJobs(), fetchUsaJobs(), extractJsonLdBlocks(), fetchCareerPageJobs(), flattenJsonLd() (+9 more)

### Community 57 - "Companies Module"
Cohesion: 0.19
Nodes (12): CompaniesController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+4 more)

### Community 58 - "Docs (58)"
Cohesion: 0.12
Nodes (19): Trade-off: No Cascade Delete, Design Decision: No FK to auth.users, profiles Table, Data Import Method, Neon Migration Plan, Post-Migration Schema Updates, Required Postgres Extensions (pgcrypto, pg_trgm, uuid-ossp), Rollback Plan (Point-in-Time Restore) (+11 more)

### Community 59 - "Public Api Module"
Cohesion: 0.11
Nodes (19): Supabase Storage Usage, Public Analytics Endpoint, API Key Authentication (Bearer/x-api-key), Public API Scopes, Public Applications/Tickets Endpoints, Public Candidates Endpoints, Public Companies Endpoints, Public Company People Endpoints (+11 more)

### Community 60 - "Lib Integrations"
Cohesion: 0.19
Nodes (12): POST(), POST(), GET(), ApiKeyValidationResult, validateApiKey(), computeIsOnline(), CrawlerJobPayload, getCrawlerStatuses() (+4 more)

### Community 61 - "Neon Cloudflare Audit Module (61)"
Cohesion: 0.14
Nodes (18): Recommended PDF Export Architecture (Final), Strategy 1: External PDF/DOCX Microservice, Decision: Externalize DOCX/PDF Export, Decision: Keep Supabase Auth Temporarily, Decision: Keep Supabase Storage Temporarily, Decision: Keep src/lib/supabase.ts Interface (Proxy Pattern), Decision: Migrate Repositories Incrementally, Decision: Neon as Main Database (+10 more)

### Community 62 - "Migration Neon Cloudflare Module"
Cohesion: 0.14
Nodes (18): Chunk 10 Progress: Packet Abstractions, Chunk 4 Quick-Application UI Guidance, Cloudflare Compatibility Notes, Migration Readiness: Neon Postgres + Cloudflare Workers, Rule: No New Direct supabase.from() in Feature Routes, Chunk 3.5 Portability Guardrails, What Not To Do Before Migration, Internal Routes Table (+10 more)

### Community 63 - "Applicationsrepository Module"
Cohesion: 0.14
Nodes (16): GET(), ApplicationEventRow, ApplicationQueueResult, ApplicationQueueStats, ApplicationRow, ApplicationSourceType, buildQueueStats(), CreateApplicationEventInput (+8 more)

### Community 64 - "Dropdown Menu Module"
Cohesion: 0.16
Nodes (16): initials(), MeResponse, roleIcon(), roleLabel(), roleOptions, TeamMember, TeamPage(), DropdownMenuCheckboxItem (+8 more)

### Community 65 - "Command Module"
Cohesion: 0.12
Nodes (15): Command, CommandDialogProps, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator (+7 more)

### Community 66 - "Tsconfig Module (66)"
Cohesion: 0.12
Nodes (16): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, incremental, module (+8 more)

### Community 67 - "Components Module"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, rsc, $schema (+8 more)

### Community 68 - "Deployment Readiness Module"
Cohesion: 0.12
Nodes (17): AI Key Manager Setup (/ops), AI_KEYS_ENCRYPTION_SECRET Env Var, Cloudflare Deployment Commands (cf:build/preview/deploy/typegen), Cron Requirements, CRON_SECRET Env Var, Deployment Readiness Guide, Deployment Target Comparison (Vercel+Supabase vs Cloudflare+Neon), Production Environment Checklist (+9 more)

### Community 69 - "Package Module (69)"
Cohesion: 0.12
Nodes (16): name, private, scripts, build, cf:build, cf:deploy, cf:preview, cf:typegen (+8 more)

### Community 70 - "Jobsrepository Module"
Cohesion: 0.21
Nodes (15): buildSalaryRange(), formatSalaryValue(), POST(), safeInsertValue(), createJobFromParsedJD(), CreateJobInput, DuplicateCheckInput, DuplicateCheckResult (+7 more)

### Community 71 - "Ops"
Cohesion: 0.12
Nodes (11): CrawlerStatus, AiCategoryStatus, BackupFile, CategorizationRun, CategorizationStatus, Digest, ImportRun, ImportSource (+3 more)

### Community 72 - "Roadmap Module"
Cohesion: 0.14
Nodes (16): AI Daily Digest, Architecture Notes (Service-Role Client, App-Layer Authorization), Backups + Restore, TalentOS (Skarion Tracker) README, Live Job Crawler Ingestion, Resume Tailoring Workflow, Universal Job Import Normalizer, AI Daily Digest (Single-Shot Generation) (+8 more)

### Community 73 - "Lib Falood (73)"
Cohesion: 0.16
Nodes (12): ApplicationResumeVersion, BaseResume, ResumeCliEditorProps, BaseResumeContext, autoFitOnePage(), AutoFitResult, estimatePageCount(), FLOORS (+4 more)

### Community 74 - "Review"
Cohesion: 0.14
Nodes (13): ApplicationPacketSummary, BaseResumeDetail, BaseResumeSummary, CandidateCompact, CandidateDetail, EvidenceRow, isToday(), MeResponse (+5 more)

### Community 75 - "Handover Module"
Cohesion: 0.15
Nodes (15): Auth Migration: Supabase Auth → Clerk, Supabase to NestJS Migration Notes, Implemented NestJS Modules, RLS → Application-Level Authorization Migration, Still to Port as Service/Controller Modules, Backend (NestJS) Status, Chunk 8: Resume Draft Builder + Versioning, Cost-Efficient Deployment Recommendations (+7 more)

### Community 76 - "Storage Hybrid Architecture Module"
Cohesion: 0.14
Nodes (15): Migration Option 3: Clerk (Third-Party Auth), Neon Compatibility Notes, Recommended Migration Sequence, Recommended Phased Migration Plan (Phase 1-5), Migration Order (12 Phases), Storage Access Control, Cloudflare R2 Storage, Storage Cost Comparison (+7 more)

### Community 77 - "Package Module (77)"
Cohesion: 0.13
Nodes (14): express, google-auth-library, dependencies, express, google-auth-library, description, engines, node (+6 more)

### Community 78 - "Mixed Cross-Cutting Cluster (78)"
Cohesion: 0.17
Nodes (15): Ad-Hoc Application Creation (No Job Masterlist Required), Auto-Create Job from Pasted JD, Bypass Base Resume Option (Original Resume / Blank), TalentOS Application Workflow Redesign + In-House AI Architecture Plan, Implementation Order (Phases 1-7), Chunk 3.5 Execution Plan: Portability Guardrails + Admin AI API Key Manager, Chunk 3.5 Progress Checklist (7 Stages), Chunk 3.5 Scope Rules (No Neon Migration, No Auth Migration, Keys Encrypted Admin-Only) (+7 more)

### Community 79 - "Neon Cloudflare Audit Module (79)"
Cohesion: 0.14
Nodes (12): In-Memory Cache Is Ephemeral, fs / child_process / path — Low (Build-Time Only), process.env at Import Time — Moderate, Supabase Auth Usage (Deep Embedded — Blocker), Supabase Dependency Audit, scripts/seed-admin.mjs, scripts/setup-check.mjs, api/auth/login/route.ts (+4 more)

### Community 80 - "Emailservice Module"
Cohesion: 0.23
Nodes (10): GET(), POST(), POST(), ProcessResult, ALLOWED_TAGS, renderTemplate(), sendEmail(), SendEmailOptions (+2 more)

### Community 81 - "Jdanalyzer Module"
Cohesion: 0.25
Nodes (11): POST(), analyzeJD(), JdAnalysisInput, JdAnalysisOutput, JdRedFlag, sanitizeEnum(), sanitizeNumber(), sanitizeRedFlags() (+3 more)

### Community 82 - "Clientexport Module"
Cohesion: 0.22
Nodes (12): DEFAULT_FORMATTING, downloadBlob(), exportAndDownloadResume(), fileNameFor(), generateResumeDocxBlob(), generateResumePdfBlob(), normalizeResumeContentForExport(), UploadExportParams (+4 more)

### Community 83 - "Package Module (83)"
Cohesion: 0.15
Nodes (13): dependencies, class-transformer, @nestjs/typeorm, nestjs-zod, pg, reflect-metadata, typeorm, class-transformer (+5 more)

### Community 84 - "Chat Conversation Module"
Cohesion: 0.15
Nodes (13): ChatConversationEntity, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, ChatMessageEntity (+5 more)

### Community 85 - "Cloudflare Diagnostic And Pdf Strategy Module"
Cohesion: 0.15
Nodes (13): PDF/DOCX Export Problem: Node.js-Only Packages, Root Cause 1: Wrong DATABASE_URL Format for HTTP Driver, Root Cause 2: Outdated @neondatabase/serverless Version, Root Cause 3: Module-Level sql Init May Fail on Cold Start, Root Cause 4: No Error Logging in Production, TalentOS Cloudflare Deployment: Root Cause Analysis & Fix Strategy, Strategy 2: Client-Side PDF Generation, Strategy 3: Serverless Function on Vercel (+5 more)

### Community 86 - "Package Module (86)"
Cohesion: 0.15
Nodes (12): devDependencies, typescript, wrangler, typescript, wrangler, name, private, scripts (+4 more)

### Community 87 - "Jobcategorization Module"
Cohesion: 0.26
Nodes (11): GET(), isAuthorized(), AiCategorizationResult, buildPrompt(), categorizeOneJob(), markFailed(), parseAiJson(), PendingJob (+3 more)

### Community 88 - "Lib (88)"
Cohesion: 0.27
Nodes (9): GET(), isAuthorized(), POST(), POST(), ImportRunResult, ImportSource, runAndRecord(), runImportSource() (+1 more)

### Community 89 - ".github Workflows"
Cohesion: 0.18
Nodes (12): Deployment Credential Gathering Step, TalentOS Full Deployment Plan, Set Wrangler Secrets Step, CI Workflow, Worker Bundle Size Check (3072 KiB budget), DATABASE_URL Secret Format Correction Step, Deploy TalentOS (Cloudflare) Workflow, Verify Live Health After Deploy Step (+4 more)

### Community 90 - "Atsscoring Module"
Cohesion: 0.27
Nodes (10): POST(), stripPII(), AtsExtractionResult, AtsNarrative, AtsScoreBreakdown, computeDeterministicScore(), extractStructuredData(), generateNarrative() (+2 more)

### Community 91 - "Messagethread Module"
Cohesion: 0.21
Nodes (9): CandidateMessage, CandidateThread, CandidateInfo, formatDateLabel(), formatTime(), initials(), Message, MessageThread() (+1 more)

### Community 92 - "Menubar Module"
Cohesion: 0.17
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 93 - "Package Module (93)"
Cohesion: 0.18
Nodes (11): devDependencies, @nestjs/cli, @nestjs/schematics, @types/express, @types/node, typescript, @types/node, typescript (+3 more)

### Community 94 - "Services"
Cohesion: 0.22
Nodes (11): Debug Session: base-resume-load-loop, Debug Session: linkedin-url-seeding, Separate Python Markitdown Microservice Decision, Markitdown Integration Plan — TalentOS, Token Savings from Markdown vs Raw Text Parsing, Broken Upload Flow Problem (pdf-parse Node-only), TalentOS Markitdown Service README, POST /parse Endpoint (PDF → Markdown) (+3 more)

### Community 95 - "Mixed Cross-Cutting Cluster (95)"
Cohesion: 0.18
Nodes (11): AI Provider Nuance — NVIDIA Kimi Tool-Call Degeneration, Chunk 9: DOCX/PDF Export + Final Resume Packet Formatting, AI Service Architecture (Provider Abstraction + Falood Stage Functions), Falood AI Full Implementation Plan, Phase 2: Complete Base Resume Studio, Phase 3: JD Analyzer + Keyword Approval, Phase 5: PDF Preview + Export, AI Assistant (/chat) (+3 more)

### Community 96 - "Seed Admin Module (96)"
Cohesion: 0.18
Nodes (7): adminEmail, env, envPath, fileEnv, missing, required, supabase

### Community 97 - "Setup Check Module"
Cohesion: 0.18
Nodes (7): env, envPath, failures, missing, placeholders, requiredEnv, requiredTables

### Community 98 - "Services Google Vertex Proxy"
Cohesion: 0.20
Nodes (5): app, auth, express, getAccessToken(), { GoogleAuth }

### Community 99 - "Api Users"
Cohesion: 0.25
Nodes (8): GET(), PATCH(), roles, GET(), POST(), roles, normalizeUserProfile(), publicUserProfile()

### Community 100 - "Googlegmail Module"
Cohesion: 0.35
Nodes (9): GET(), base64urlDecode(), decodeJwtPayload(), exchangeGmailCode(), getGoogleEmail(), GMAIL_SCOPES, gmailAuthUrl(), googleRedirectUri() (+1 more)

### Community 101 - "Sharepoint Module"
Cohesion: 0.40
Nodes (9): GET(), base64urlEncodeString(), deleteFromSharePoint(), downloadFromSharePoint(), encodeGraphPath(), ensureFolderPath(), getGraphToken(), requireEnv() (+1 more)

### Community 102 - "Candidates [id] Applications"
Cohesion: 0.18
Nodes (9): ApplicationResumeVersion, BaseResume, CandidateDetail, Evidence, Job, Keyword, KeywordApproval, STEP_LABELS (+1 more)

### Community 103 - "Components Ui (103)"
Cohesion: 0.24
Nodes (8): AiSuggestions(), ChatMessage, SkillCategory, Suggestion, CardFooter, ScrollArea, ScrollBar, Skeleton()

### Community 104 - "Cloudflare Known Limitations Module"
Cohesion: 0.22
Nodes (10): Buffer Usage: Partially Supported, TalentOS Cloudflare Workers Deployment: Known Limitations, Cron Jobs Not Supported on Free Tier, DOCX Export Will Fail on Cloudflare Workers, External Service Architecture (Recommended for Production), File System Access Not Supported, KV Storage Available on Free Tier, PDF Export Will Fail on Cloudflare Workers (+2 more)

### Community 105 - "Communications Sequences"
Cohesion: 0.22
Nodes (7): EmailSequence, SequencesPage(), SequenceStep, TemplateOption, TRIGGER_EVENTS, SequenceBuilderProps, SequenceStep

### Community 106 - "Companies [id]"
Cohesion: 0.20
Nodes (5): CompanyApplication, CompanyApplicationLog, CompanyDetail, CompanyJob, CompanyPerson

### Community 107 - "Interviews"
Cohesion: 0.36
Nodes (9): addDays(), formatDate(), formatTime(), initials(), InterviewItem, InterviewsPage(), isSameDay(), startOfWeek() (+1 more)

### Community 108 - "Context Menu Module"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 109 - "Package Module (109)"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, start, start:dev, typecheck, version

### Community 110 - "Plan Ai Provider Routing And Grammarly Editing Module"
Cohesion: 0.22
Nodes (9): Plan: Multi-Provider Routing + Grammarly-Style Resume Editing, Phase 1: Add OpenAI and GLM (Zhipu) Providers, Phase 2: Per-Task-Category Provider/Key Routing, Phase 3: System Health Visibility, Phase 4: Grammarly-Style Inline Resume Editing, Mandatory Verification Checklist (typecheck/lint/build/bundle-size/live-schema), Phase 4: Application Resume Studio, Google Vertex AI Proxy README (+1 more)

### Community 111 - "Teams Module"
Cohesion: 0.42
Nodes (7): authorized(), normalizePayload(), POST(), fact(), sendTeamsNotification(), TalentOsNotification, talentOsTeamsCard()

### Community 112 - "Ats Score"
Cohesion: 0.31
Nodes (5): AtsScorePage(), initials(), AuditLog, CardSkeleton(), TableSkeleton()

### Community 113 - "Candidates"
Cohesion: 0.33
Nodes (6): Candidate, CandidatesPage(), initials(), downloadCsv(), escapeCsvCell(), toCsv()

### Community 114 - "Onboarding"
Cohesion: 0.28
Nodes (8): defaultState, isValidEmail(), OnboardingPage(), OnboardingState, plans, roleOptions, slugify(), teamSizeOptions

### Community 115 - "Inlinediffeditor Module"
Cohesion: 0.31
Nodes (7): getChangedSections(), getSectionData(), getSectionLabel(), InlineDiffEditor(), Props, SectionPath, SectionResolution

### Community 116 - "Table Module"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 117 - "Company Person Module"
Cohesion: 0.25
Nodes (7): CompanyPersonEntity, Column, Entity, Index, JoinColumn, ManyToOne, InjectRepository

### Community 118 - "Application Queue"
Cohesion: 0.25
Nodes (4): MeResponse, QueueItem, QueueStats, TeamUser

### Community 119 - "Communications Templates"
Cohesion: 0.25
Nodes (4): CATEGORIES, EmailTemplate, MERGE_TAGS, TemplateEditorProps

### Community 120 - "Interviews Schedule"
Cohesion: 0.25
Nodes (6): ApplicationOption, DURATIONS, LOCATIONS, PanelMemberInput, ScorecardTemplate, TeamUser

### Community 121 - "Portal [token]"
Cohesion: 0.25
Nodes (5): PortalApplication, PortalData, PortalGmailAccount, PortalStats, Update

### Community 122 - "Select Module"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 123 - "Tsconfig Module (123)"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, strict, target

### Community 124 - "Api Falood Applications"
Cohesion: 0.43
Nodes (5): DELETE(), GET(), normalizeRow(), PATCH(), safeParseJson()

### Community 125 - "Follow Ups"
Cohesion: 0.29
Nodes (3): FollowUp, FollowUpStats, PaginationProps

### Community 126 - "Apply Schema Module"
Cohesion: 0.33
Nodes (4): fs, { neon }, schema, sql

### Community 127 - "Plan Module"
Cohesion: 0.53
Nodes (6): Migration Sprint (2026-07-07) — Neon + Cloudflare Infrastructure, Async Signature Changes & Caller Updates, Plan: Neon Adapter + Cloudflare Workers Migration, Web Crypto API Rewrites (Security-Critical), In Progress — Neon + Cloudflare Migration (Phases 1-10), Neon + Cloudflare Migration Sprint (2026-07-07)

### Community 128 - "Find Unconditional Supabase Module"
Cohesion: 0.33
Nodes (4): bad, fs, path, routes

### Community 129 - "Find Unconditional Supabase V2 Module"
Cohesion: 0.33
Nodes (4): bad, fs, path, routes

### Community 130 - "Communications Logs"
Cohesion: 0.33
Nodes (4): CHANNEL_OPTIONS, EmailLog, STATUS_COLORS, STATUS_OPTIONS

### Community 131 - "Import Sources"
Cohesion: 0.40
Nodes (5): ImportRun, ImportSource, ImportSourcesPage(), providerLabel(), providers

### Community 132 - "Ai Task Routing Module"
Cohesion: 0.33
Nodes (4): AiKey, CATEGORIES, PROVIDERS, RoutingConfig

### Community 133 - "Activityfeed Module"
Cohesion: 0.47
Nodes (5): ActivityFeed(), ActivityLog, groupByDate(), linkFor(), typeIcons

### Community 134 - "Interviewcard Module"
Cohesion: 0.47
Nodes (5): initials(), Interview, InterviewCard(), InterviewPanelMember, statusBadgeClass()

### Community 135 - ".eslintrc Module"
Cohesion: 0.40
Nodes (4): extends, rules, react/no-unescaped-entities, next/core-web-vitals

### Community 136 - "Seed Admin Module (136)"
Cohesion: 0.60
Nodes (4): encodeBase64(), hashPassword(), { neon }, seed()

### Community 137 - "Services Render Keepalive Worker"
Cohesion: 0.60
Nodes (4): Env, fetch(), pingRender(), scheduled()

### Community 138 - "Notifications"
Cohesion: 0.40
Nodes (3): Notification, typeBadge, typeIcons

### Community 139 - "Ai Key Manager Module"
Cohesion: 0.40
Nodes (3): AiKey, MODEL_OPTIONS, PROVIDERS

### Community 140 - "Settings Api Keys"
Cohesion: 0.40
Nodes (3): ApiKey, ApiKeyListResponse, MeResponse

### Community 141 - "Settings Webhooks"
Cohesion: 0.40
Nodes (3): ALL_EVENTS, WebhookEndpoint, WebhookEvent

### Community 142 - "Docxexport Module"
Cohesion: 0.70
Nodes (4): buildResumeDocxDocument(), bulletParagraph(), contactLine(), sectionHeading()

### Community 143 - "Nest Cli Module"
Cohesion: 0.50
Nodes (3): collection, $schema, sourceRoot

### Community 145 - "Mixed Cross-Cutting Cluster (145)"
Cohesion: 0.67
Nodes (4): Chunk 10: Application Packet Builder, Phase 6: Application Packet + Ticket Closure, Chunk 10: Application Packet Builder (Done), Chunk 10: Application Packet Builder + Production Deployment Readiness

### Community 148 - "Api Cron Email Queue"
Cohesion: 0.83
Nodes (3): GET(), isAuthorized(), processEmailQueue()

### Community 151 - "Neon Cloudflare Audit Module (151)"
Cohesion: 0.67
Nodes (3): auth.users References (SQL Schema), sql/01_schema.sql, supabase/migrations/20260617090000_auth_profiles_roles.sql

## Ambiguous Edges - Review These
- `AI Assistant (/chat)` → `Stress Test Plan — TalentOS`  [AMBIGUOUS]
  stress-test-plan.md · relation: references
- `Falood AI Full Implementation Plan` → `Stress Test Plan — TalentOS`  [AMBIGUOUS]
  stress-test-plan.md · relation: conceptually_related_to
- `Neon Safe Migration Runbook` → `Data Migration: Supabase to Neon`  [AMBIGUOUS]
  docs/neon-safe-migration-runbook.md · relation: references

## Knowledge Gaps
- **881 isolated node(s):** `next/core-web-vitals`, `react/no-unescaped-entities`, `{ neon }`, `sql`, `fs` (+876 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `AI Assistant (/chat)` and `Stress Test Plan — TalentOS`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Falood AI Full Implementation Plan` and `Stress Test Plan — TalentOS`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Neon Safe Migration Runbook` and `Data Migration: Supabase to Neon`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `isNeon()` connect `Api (13)` to `Api (1)`, `Api Public`, `Api (5)`, `Server Storage`, `Api (10)`, `Lib (12)`, `Api (14)`, `Lib Normalizer`, `Lib Ai (21)`, `Applicationkeywordsrepository Module`, `Lib Ai (27)`, `Server Repositories`, `Api (33)`, `Applicationresumeversionsrepository Module`, `Server Services`, `Aikeyrepository Module`, `Applicationpacketaiservice Module`, `Applicationresumesuggestionsrepository Module`, `Lib Ai (42)`, `Resumeexportservice Module`, `Api Base Resumes`, `Jobdedup Module`, `Lib Integrations`, `Applicationsrepository Module`, `Jobsrepository Module`, `Emailservice Module`, `Jobcategorization Module`, `Lib (88)`, `Api Users`, `Googlegmail Module`, `Teams Module`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `cn()` connect `Components Ui (2)` to `Dropdown Menu Module`, `Command Module`, `Use Toast Module`, `Components Ui (103)`, `Components Falood Resumify (11)`, `Context Menu Module`, `Onboarding`, `Table Module`, `Import`, `Components Falood Resumify (24)`, `Select Module`, `Menubar Module`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `requireCurrentUser()` connect `Api (1)` to `Api Public`, `Api (5)`, `Server Storage`, `Api (10)`, `Lib (12)`, `Api (13)`, `Api (14)`, `Lib Normalizer`, `Lib Ai (21)`, `Applicationkeywordsrepository Module`, `Lib Ai (27)`, `Server Repositories`, `Api (33)`, `Aikeyrepository Module`, `Applicationpacketaiservice Module`, `Applicationresumesuggestionsrepository Module`, `Resumeexportservice Module`, `Api Base Resumes`, `Lib Integrations`, `Migration Neon Cloudflare Module`, `Applicationsrepository Module`, `Jobsrepository Module`, `Emailservice Module`, `Jdanalyzer Module`, `Lib (88)`, `Api Users`, `Sharepoint Module`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `next/core-web-vitals`, `react/no-unescaped-entities`, `{ neon }` to the rest of the system?**
  _912 weakly-connected nodes found - possible documentation gaps or missing edges._