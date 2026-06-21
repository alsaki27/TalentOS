#!/usr/bin/env node
// Seed admin user into Neon profiles table
// Usage: node seed_admin.js admin@example.com "Admin User" "your-password"

const { neon } = require("@neondatabase/serverless");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in the environment before running this script.");

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw", passwordBuffer, "PBKDF2", false, ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH * 8
  );

  return `pbkdf2:sha256:${ITERATIONS}:${encodeBase64(salt.buffer)}:${encodeBase64(hashBuffer)}`;
}

async function seed() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const displayName = process.argv[3] || process.env.ADMIN_NAME || "Admin";
  const password = process.argv[4] || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: node seed_admin.js <email> <display_name> <password>");
    console.error("Or set: ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD env vars");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const sql = neon(url, { fetchOptions: { cache: "no-store" } });

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  const profile = await sql(
    `INSERT INTO profiles (user_id, email, display_name, role, is_active, password_hash, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       role = EXCLUDED.role,
       is_active = EXCLUDED.is_active,
       password_hash = EXCLUDED.password_hash,
       email_verified = EXCLUDED.email_verified,
       updated_at = EXCLUDED.updated_at
     RETURNING user_id, email, display_name, role, is_active`,
    [userId, email.toLowerCase(), displayName, "admin", true, passwordHash, true, new Date().toISOString()]
  );

  console.log("Admin user created/updated:");
  console.log("  user_id:", profile[0].user_id);
  console.log("  email:", profile[0].email);
  console.log("  display_name:", profile[0].display_name);
  console.log("  role:", profile[0].role);
  console.log("\nLogin at: http://localhost:3000/login");
}

seed().catch(e => { console.error(e); process.exit(1); });
