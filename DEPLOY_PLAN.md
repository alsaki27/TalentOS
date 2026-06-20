# TalentOS Full Deployment Plan

## Step 1: Gather Credentials

I need the following values from you to proceed:

### Neon Postgres (Required)
- `DATABASE_URL` — Your Neon pooled connection string (looks like: `postgres://user:password@ep-xxx-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require`)
- `NEON_DATABASE_URL` — Same as above
- `NEON_DATABASE_URL_DIRECT` — Your direct connection string (for migrations, no pooling)

### Supabase Auth (Required — keeping auth on Supabase)
- `SUPABASE_URL` — e.g. `https://abcdefgh12345678.supabase.co`
- `SUPABASE_ANON_KEY` — Your anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Your service_role key (keep secret!)

### Cloudflare (Required for deploy)
- `CLOUDFLARE_ACCOUNT_ID` — From Cloudflare dashboard
- Do you have `wrangler` CLI authenticated? Run `npx wrangler whoami` to check.

### AI / Encryption (Required for full functionality)
- `AI_KEYS_ENCRYPTION_SECRET` — A 32-byte hex string (generate with `openssl rand -hex 32`)
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — Your AI provider key
- `CRON_SECRET` — A random string for securing cron endpoints
- `TALENT_OS_WEBHOOK_SECRET` — A random string for webhook verification

### Optional
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — If using Gmail integration
- `USAJOBS_API_KEY` / `USAJOBS_USER_AGENT` — If using USAJOBS import

## Step 2: Apply Schema to Neon

```bash
psql $DATABASE_URL -f neon/migrations/0001_initial_schema.sql
```

Verify tables exist:
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"
```
Expected: 56

## Step 3: Migrate Data (if you have existing data in Supabase)

If you have existing data in Supabase that needs to be moved to Neon, I will run the migration script.

If this is a fresh install (no existing data), skip this step.

## Step 4: Set Wrangler Secrets

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put DB_PROVIDER
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put AI_KEYS_ENCRYPTION_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CRON_SECRET
npx wrangler secret put TALENT_OS_WEBHOOK_SECRET
npx wrangler secret put CRAWLER_API_KEY
```

## Step 5: Build & Deploy

```bash
npm run cf:build
npx wrangler deploy
```

## Step 6: Verify Deployment

1. Visit the deployed URL (shown in wrangler output)
2. Test login (should work via Supabase Auth)
3. Create a candidate (should write to Neon)
4. Check that data appears in Neon dashboard

## Step 7: Post-Deployment

- [ ] Update DNS / custom domain (if applicable)
- [ ] Set up external cron scheduler (cron-job.org) for digest emails
- [ ] Monitor error logs in Cloudflare dashboard
- [ ] Verify Neon compute hours are within free tier limits

---

## What I Need From You Right Now

Please provide the following values. I'll keep them confidential and only use them for deployment:

1. **Neon DATABASE_URL** (the pooled connection string)
2. **Neon DATABASE_URL_DIRECT** (the direct connection string, for migrations)
3. **Supabase URL** (e.g., `https://...supabase.co`)
4. **Supabase Anon Key**
5. **Supabase Service Role Key**
6. **Cloudflare Account ID** (or run `npx wrangler whoami` and tell me the output)

Optional but recommended:
7. **AI_KEYS_ENCRYPTION_SECRET** (or I'll generate one)
8. **ANTHROPIC_API_KEY** or **OPENAI_API_KEY**
9. **CRON_SECRET** (or I'll generate one)
10. **TALENT_OS_WEBHOOK_SECRET** (or I'll generate one)

Once you provide these, I'll execute all steps automatically.
