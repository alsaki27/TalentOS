# Cloudflare Environment Secrets Setup — TalentOS/Skarion Tracker

**Created:** 2026-07-07
**Target:** Cloudflare Workers/Pages with OpenNext
**Auth:** Supabase Auth kept temporarily (Hybrid Option A)

---

## 1. Required Secrets

Set these via Wrangler CLI. Do not commit values to the repo.

### Database

```bash
npx wrangler secret put DATABASE_URL
# Paste: postgres://user:password@host.neon.tech/dbname?sslmode=require

npx wrangler secret put NEON_DATABASE_URL
# Paste: same as DATABASE_URL

npx wrangler secret put NEON_DATABASE_URL_DIRECT
# Paste: direct connection string for migrations (non-pooled)
```

### Supabase Auth (temporary)

```bash
npx wrangler secret put SUPABASE_URL
# Paste: https://your-project.supabase.co

npx wrangler secret put SUPABASE_ANON_KEY
# Paste: your-anon-key

npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
# Paste: same as SUPABASE_ANON_KEY

npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Paste: your-service-role-key (server-side only)
```

### AI / Encryption

```bash
npx wrangler secret put AI_KEYS_ENCRYPTION_SECRET
# Paste: 32-byte hex string (e.g., from openssl rand -hex 32)

npx wrangler secret put ANTHROPIC_API_KEY
# Paste: your Anthropic API key (if using Anthropic)

npx wrangler secret put NVIDIA_API_KEY
# Paste: your NVIDIA API key (if using NVIDIA)

npx wrangler secret put OPENAI_API_KEY
# Paste: your OpenAI API key (if using OpenAI — optional)
```

### App Security

```bash
npx wrangler secret put CRON_SECRET
# Paste: random string (e.g., from openssl rand -base64 32)

npx wrangler secret put TALENT_OS_WEBHOOK_SECRET
# Paste: random string

npx wrangler secret put CRAWLER_API_KEY
# Paste: random string
```

### OAuth (if using integrations)

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REDIRECT_URI

npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET

npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
npx wrangler secret put MS_TENANT_ID
```

### External APIs (if using)

```bash
npx wrangler secret put USAJOBS_API_KEY
npx wrangler secret put USAJOBS_USER_AGENT
```

---

## 2. Optional: Wrangler Vars (non-secret)

These can be set via `wrangler.jsonc` or Wrangler CLI:

```bash
npx wrangler vars put AI_PROVIDER
# Value: anthropic or nvidia

npx wrangler vars put NODE_ENV
# Value: production

npx wrangler vars put APP_BASE_URL
# Value: https://your-app.pages.dev or custom domain

npx wrangler vars put RESUME_STORAGE_PROVIDER
# Value: supabase (keep temporarily) or sharepoint
```

---

## 3. Local Development with Cloudflare

For local development, use `.dev.vars` (not `.env.local` for Cloudflare Workers):

```bash
# .dev.vars (gitignored)
DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AI_KEYS_ENCRYPTION_SECRET=your-encryption-secret
CRON_SECRET=your-cron-secret
ANTHROPIC_API_KEY=your-anthropic-key
```

**Note:** `wrangler dev` reads `.dev.vars` automatically. `next dev` still uses `.env.local` for local Next.js development.

---

## 4. Wrangler Secret Verification

After setting all secrets, verify:

```bash
npx wrangler secret list
```

This shows all secret names (not values). If any are missing, add them.

---

## 5. Security Reminders

- **Never commit secrets** to the repo. `.dev.vars` and `.env.local` should be in `.gitignore`.
- **Rotate secrets** that were previously exposed in chat, screenshots, or shared environments.
- **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`) must never be exposed to the browser. It is server-side only.
- **AI encryption key** (`AI_KEYS_ENCRYPTION_SECRET`) must be the same across environments if you want encrypted AI keys to be portable. If different, re-add keys via the AI key manager.
- **Neon connection string** uses SSL (`sslmode=require`). Do not disable SSL in production.

---

*End of Cloudflare env secrets guide.*
