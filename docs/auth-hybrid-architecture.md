# TalentOS Auth Hybrid Architecture

## Overview

TalentOS uses a **hybrid architecture** for authentication:
- **Supabase Auth** handles authentication (login, signup, password reset, JWT tokens)
- **Neon Postgres** handles all business data (candidates, jobs, applications, etc.)

## Why Hybrid?

1. **Auth migration is complex** — Moving user authentication, sessions, and JWT validation is risky
2. **Supabase Auth is free** — The free tier handles up to 50,000 users/month
3. **Supabase Auth works well** — It already handles OAuth (Google, GitHub), magic links, password resets
4. **Zero-downtime migration** — We can migrate data first, auth later (or never)

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                    User Browser                          │
└──────────────────┬───────────────────────────────────────┘
                   │
                   │ 1. Login with email/password
                   ▼
┌──────────────────────────────────────────────────────────┐
│              Cloudflare Workers (Next.js)              │
│  - Receives login request                                │
│  - Calls Supabase Auth for authentication              │
│  - Receives JWT token                                    │
│  - All business DB queries go to Neon                  │
└──────────────────┬───────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌─────────────────────────┐
│ Supabase Auth │      │    Neon Postgres        │
│  - users     │      │  - candidates           │
│  - sessions  │      │  - jobs                  │
│  - JWT       │      │  - applications         │
│  - OAuth     │      │  - all business data     │
└──────────────┘      └─────────────────────────┘
```

## Data Flow

### Login Flow
1. User submits credentials to `/api/auth/login`
2. Server calls `supabase.auth.signInWithPassword()` → Supabase Auth
3. Supabase returns a JWT token
4. Server stores JWT in a cookie (or returns it to the client)
5. All subsequent requests use the JWT to identify the user

### Authenticated Request Flow
1. Client sends request with JWT cookie
2. Server calls `supabase.auth.getUser(token)` to validate the JWT
3. Server gets `user_id` from the JWT payload
4. Server looks up `profile` in Neon using `user_id` (plain UUID, no FK constraint)
5. Server queries business data from Neon
6. Server returns response

## Code Pattern

Every authenticated route uses the same pattern:

```typescript
import { getCurrentUserContext } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // context.profile.user_id is the Supabase user ID
  // context.profile is loaded from Neon (or Supabase, depending on DB_PROVIDER)
  
  const userId = context.profile.user_id;
  
  // Query business data from Neon
  const candidates = await query(
    "SELECT * FROM candidates WHERE created_by = $1",
    [userId]
  );
  
  return NextResponse.json(candidates);
}
```

## The `profiles` Table

The `profiles` table bridges Supabase Auth and Neon:

```sql
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY,  -- Matches Supabase auth.users.id, but NO FK constraint
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Key Design Decision: No FK to auth.users

We removed the `FOREIGN KEY (user_id) REFERENCES auth.users(id)` constraint because:
1. `auth.users` is a Supabase-specific schema not available in Neon
2. Without the FK, we can store profiles in Neon independently
3. The app validates user identity via JWT, not database constraints

### Trade-off: No Cascade Delete

If a user is deleted from Supabase Auth, their profile remains in Neon. This is acceptable because:
- User deletion is rare
- We can implement a periodic cleanup job
- The profile data (name, email) is useful for audit trails

## Migration Path (if you want to move auth off Supabase)

### Option 1: Keep Supabase Auth Permanently (Recommended)

Supabase Auth is free, reliable, and handles OAuth. No migration needed.

### Option 2: Custom Auth with Neon

If you want to own auth completely:

1. **Create a users table in Neon** (encrypted passwords, email verification)
2. **Implement JWT signing/verification** in the app (using Web Crypto API)
3. **Migrate users** from Supabase Auth to Neon users table
4. **Update `getCurrentUserContext()`** to validate JWTs from your own signing key
5. **Remove Supabase Auth dependency**

This is complex and risky. Only do this if you have a strong reason.

### Option 3: Clerk (Third-party Auth)

Replace Supabase Auth with [Clerk](https://clerk.com/):

1. Sign up for Clerk
2. Replace `supabase.auth` calls with `clerkClient` calls
3. Clerk works with any database (Neon, Supabase, etc.)
4. Clerk has a generous free tier (10,000 MAU)

This is the easiest migration path if you want to leave Supabase Auth.

## Security Considerations

### JWT Validation

The JWT from Supabase Auth is validated by calling `supabase.auth.getUser(token)` on every request. This makes a network call to Supabase. If you want to avoid this:

1. Cache the JWT validation result in Redis/KV for 5-10 minutes
2. Or validate JWTs locally using the Supabase JWT secret (requires `SUPABASE_JWT_SECRET`)

### Service Role Key

The `SUPABASE_SERVICE_ROLE_KEY` is used for admin operations (creating users, updating passwords). This key is powerful and should be:
- Kept in a secure secret store (never in code)
- Rotated periodically
- Only used server-side

## Environment Variables

```bash
# Supabase Auth (required for hybrid auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Neon (for business data)
DB_PROVIDER=neon
DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
```

## Testing Auth in Neon Mode

```bash
# Set DB_PROVIDER to neon but keep Supabase auth vars
DB_PROVIDER=neon DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run dev

# Login should work (goes to Supabase Auth)
# Business data should come from Neon
```

## Troubleshooting

### Issue: `supabase.auth.getUser()` fails
**Cause:** Invalid or expired JWT token
**Fix:** Check that `NEXT_PUBLIC_SUPABASE_ANON_KEY` matches the project. Check token expiration.

### Issue: Profile not found in Neon after login
**Cause:** Profile wasn't migrated from Supabase to Neon
**Fix:** Ensure the `profiles` table was populated during data migration. Or the user is new and hasn't had a profile created yet.

### Issue: `user_id` in profiles doesn't match Supabase user ID
**Cause:** Profile was created with a different UUID
**Fix:** During migration, ensure `profiles.user_id` matches `auth.users.id` exactly. Supabase uses UUID v4.

---

## Summary

- **Supabase Auth stays** for authentication (login, JWT, OAuth)
- **Neon handles all business data** (candidates, jobs, applications)
- **Profiles table bridges both** (no FK constraint, just plain UUID)
- **Migration is optional** — the hybrid approach works indefinitely
- **Switching auth later** is possible (Clerk, custom auth) but complex
