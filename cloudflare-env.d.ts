// Cloudflare Workers environment type definitions for TalentOS.
// Generated via `npm run cf:typegen` or maintained manually.
// These are the secrets and vars bound to the Worker via wrangler.toml
// or `wrangler secret put` / `wrangler vars put`.

interface CloudflareEnv {
  // ── Database ──
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
  NEON_DATABASE_URL_DIRECT?: string;

  // ── Supabase Auth (temporary — Hybrid Option A) ──
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;

  // ── AI / Encryption ──
  AI_KEYS_ENCRYPTION_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  OPENAI_API_KEY?: string;
  AI_PROVIDER?: string;

  // ── App Security ──
  CRON_SECRET?: string;
  TALENT_OS_WEBHOOK_SECRET?: string;
  CRAWLER_API_KEY?: string;
  APP_BASE_URL?: string;
  NODE_ENV?: string;

  // ── R2 Storage ──
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
  RESUME_STORAGE_PROVIDER?: string;

  // ── Gmail OAuth ──
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;

  // ── Microsoft / SharePoint ──
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT_ID?: string;
  SHAREPOINT_SITE_ID?: string;
  SHAREPOINT_DRIVE_FOLDER?: string;
  TEAMS_TALENT_OS_WEBHOOK_URL?: string;

  // ── External APIs ──
  USAJOBS_API_KEY?: string;
  USAJOBS_USER_AGENT?: string;

  // ── First admin bootstrap ──
  ADMIN_EMAIL?: string;
}
