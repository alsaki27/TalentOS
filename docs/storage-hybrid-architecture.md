# TalentOS Storage Hybrid Architecture

## Overview

TalentOS uses a **hybrid storage architecture**:
- **Supabase Storage** for file uploads (resumes, photos, proofs, avatars)
- **Cloudflare R2** (optional future) or **Neon** for metadata only

## Why Hybrid?

1. **Supabase Storage is free** — 1 GB storage, 2 GB egress/month on free tier
2. **Supabase Storage has signed URLs** — Secure file access with expiration
3. **Moving files is hard** — Downloading and re-uploading all files is slow and risky
4. **Zero-downtime** — Keep files where they are, just change metadata references

## How It Works

### File Upload Flow

```
1. User uploads resume file
   → Next.js route handler receives file
   → Uploads to Supabase Storage bucket
   → Supabase returns a signed URL
   → Store URL in Neon (candidates.resume_url)

2. User views resume
   → App loads candidate from Neon
   → Uses the signed URL from Supabase Storage
   → Browser fetches directly from Supabase CDN
```

### Storage Buckets

| Bucket | Purpose | Migration Path |
|--------|---------|---------------|
| `resumes` | Candidate resume files | Keep on Supabase or migrate to R2 |
| `avatars` | User profile photos | Keep on Supabase or migrate to R2 |
| `proofs` | Application proof documents | Keep on Supabase or migrate to R2 |
| `exports` | Generated PDF/DOCX files | Keep on Supabase or migrate to R2 |

## Code Pattern

File upload (server-side):

```typescript
import { supabase } from "@/lib/supabase";

async function uploadResume(file: File, candidateId: string) {
  const path = `${candidateId}/${Date.now()}-${file.name}`;
  
  const { data, error } = await supabase.storage
    .from("resumes")
    .upload(path, file, { upsert: true });
  
  if (error) throw error;
  
  const { data: urlData } = supabase.storage
    .from("resumes")
    .getPublicUrl(path);
  
  // Store URL in Neon (or Supabase, depending on DB_PROVIDER)
  await query(
    "UPDATE candidates SET resume_url = $1, resume_filename = $2 WHERE id = $3",
    [urlData.publicUrl, file.name, candidateId]
  );
  
  return urlData.publicUrl;
}
```

File download (client-side):

```typescript
// The URL is stored in the database and returned in API responses
const candidate = await fetch(`/api/candidates/${id}`).then(r => r.json());
// candidate.resume_url is a Supabase Storage public URL
// The browser fetches this directly from Supabase CDN
```

## Storage in the Database

The database stores URLs, not file contents:

```sql
-- candidates table
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  resume_url TEXT,        -- URL to file in Supabase Storage
  resume_filename TEXT,    -- Original filename
  avatar_url TEXT,         -- URL to avatar in Supabase Storage
  ...
);

-- applications table
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_url TEXT,          -- URL to proof document in Supabase Storage
  proof_filename TEXT,     -- Original filename
  ...
);
```

## Migration Options

### Option 1: Keep Supabase Storage (Recommended)

Keep files on Supabase Storage indefinitely. The URLs in the database work regardless of whether the business data is in Supabase or Neon.

**Pros:**
- Zero migration effort
- Supabase Storage free tier is generous
- Signed URLs provide security
- CDN delivery is fast

**Cons:**
- Two services to manage
- File URLs contain `supabase.co` domain
- If Supabase project is deleted, files are lost

### Option 2: Migrate to Cloudflare R2

Move all files to Cloudflare R2 (S3-compatible, 10GB free):

**Migration Steps:**
1. Create R2 bucket
2. Download all files from Supabase Storage
3. Upload to R2 with the same paths
4. Update all URLs in the database
5. Update upload code to use R2 SDK

**Pros:**
- One provider (Cloudflare) for everything
- 10GB free storage (vs 1GB on Supabase)
- No egress fees (unlike S3)
- Custom domain support

**Cons:**
- Migration effort (download + re-upload all files)
- Need to update upload/download code
- R2 doesn't have signed URLs built-in (need Workers for that)

### Option 3: Migrate to Backblaze B2

Similar to R2 but cheaper for storage:

**Pros:**
- Very cheap storage ($0.005/GB)
- Free egress (up to 3x daily storage)
- S3-compatible API

**Cons:**
- Another vendor to manage
- Migration effort

## Code Changes for R2 Migration

If you decide to migrate to R2, here are the code changes needed:

### 1. Install R2 SDK

```bash
npm install aws-sdk  # R2 is S3-compatible
```

### 2. Create R2 Client

```typescript
// src/lib/r2.ts
import { S3Client } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

### 3. Update Upload Function

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";

async function uploadToR2(file: File, path: string) {
  const buffer = await file.arrayBuffer();
  
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: path,
    Body: Buffer.from(buffer),
    ContentType: file.type,
  }));
  
  return `https://${process.env.R2_PUBLIC_URL}/${path}`;
}
```

### 4. Update Database URLs

```sql
-- Update all Supabase URLs to R2 URLs
UPDATE candidates SET 
  resume_url = REPLACE(resume_url, 'https://xxx.supabase.co/storage/v1/object/public/resumes/', 'https://r2.yourdomain.com/resumes/'),
  avatar_url = REPLACE(avatar_url, 'https://xxx.supabase.co/storage/v1/object/public/avatars/', 'https://r2.yourdomain.com/avatars/');

UPDATE applications SET 
  proof_url = REPLACE(proof_url, 'https://xxx.supabase.co/storage/v1/object/public/proofs/', 'https://r2.yourdomain.com/proofs/');
```

## Environment Variables

### Supabase Storage (current)

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Cloudflare R2 (future)

```bash
CLOUDFLARE_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=talentos-files
R2_PUBLIC_URL=files.yourdomain.com
```

## Testing Storage

```bash
# Upload a test file
# Check that the URL is accessible
# Verify the URL is stored in the database

# Test with Supabase Storage (current)
# Test with R2 (after migration)
```

## Security Considerations

### Signed URLs vs Public URLs

**Supabase Storage Signed URLs:**
- Expire after a set time (e.g., 1 hour)
- More secure for sensitive documents
- Require server-side generation

**Public URLs:**
- Permanent (until file is deleted)
- Anyone with the URL can access the file
- Good for public assets (avatars, logos)

**Recommendation:** Use signed URLs for resumes and proofs, public URLs for avatars.

### Access Control

Supabase Storage supports RLS on buckets, but since we're not using RLS in Neon, we need app-level control:

```typescript
// Before returning a file URL, check permissions
async function getResumeUrl(candidateId: string, userId: string) {
  const candidate = await queryOne(
    "SELECT * FROM candidates WHERE id = $1",
    [candidateId]
  );
  
  // Check if user has permission to view this candidate's resume
  if (!candidate || candidate.created_by !== userId) {
    throw new Error("Unauthorized");
  }
  
  return candidate.resume_url;
}
```

## Cost Comparison

| Service | Storage | Egress | Free Tier | Notes |
|---------|---------|--------|-----------|-------|
| Supabase Storage | $0.021/GB | $0.09/GB | 1GB | Good for small projects |
| Cloudflare R2 | $0.015/GB | Free | 10GB | No egress fees |
| Backblaze B2 | $0.005/GB | Free | 10GB | Very cheap |
| AWS S3 | $0.023/GB | $0.09/GB | 5GB | Most features |

For a small project, Supabase Storage free tier is sufficient. For larger projects, R2 is the best value.

## Summary

- **Supabase Storage works fine** for the hybrid architecture
- **No migration required** — URLs in the database work with any storage provider
- **R2 is the best future option** if you want to consolidate on Cloudflare
- **Migration is optional** — the hybrid approach works indefinitely
- **Signed URLs** provide security for sensitive documents

---

## Recommendation

**Keep Supabase Storage for now.** It's free, it works, and migrating files is a lot of work. If you ever need to move off Supabase completely, R2 is the easiest migration path.
