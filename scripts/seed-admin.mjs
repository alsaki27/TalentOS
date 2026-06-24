import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const defaultAdminEmail = "admin@skarion.local";

function loadEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function isMissing(name, value) {
  return !value || value.includes("your-") || value.includes("placeholder") || (name.includes("KEY") && value.length < 20);
}

async function findUserByEmail(client, email) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

const fileEnv = loadEnvFile(envPath);
const env = { ...fileEnv, ...process.env };
const adminEmail = (env.ADMIN_EMAIL || defaultAdminEmail).trim().toLowerCase();

console.log("TalentOS admin bootstrap");
console.log("========================");
console.log(`Admin email: ${adminEmail}`);
console.log("This script does not create a password or print secrets.");
console.log("Create the Auth user/password in Supabase Authentication first.");

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((name) => isMissing(name, env[name]));
if (missing.length) {
  console.error(`\nMissing or placeholder env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env.local and fill values from Supabase Project Settings > API.");
  process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
});

let user;
try {
  user = await findUserByEmail(supabase, adminEmail);
} catch (error) {
  console.error(`\nCould not list Supabase Auth users: ${error.message}`);
  console.error("Verify SUPABASE_SERVICE_ROLE_KEY is the service-role/secret key, not the anon key.");
  process.exit(1);
}

if (!user) {
  console.error(`\nNo Supabase Auth user found for ${adminEmail}.`);
  console.error("Create the user in Supabase Dashboard > Authentication > Users, set a password, then rerun npm run seed:admin.");
  process.exit(1);
}

const displayName = user.user_metadata?.display_name || adminEmail.split("@")[0] || "Admin";
const { error } = await supabase.from("profiles").upsert(
  {
    user_id: user.id,
    email: user.email,
    display_name: displayName,
    role: "admin",
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  { onConflict: "user_id" },
);

if (error) {
  console.error(`\nCould not upsert admin profile: ${error.message}`);
  console.error("Make sure migrations have been applied with: npx supabase db push");
  process.exit(1);
}

console.log("\nAdmin profile is ready.");
console.log("Next: start the app with npm run dev and log in at /login using the Supabase Auth password.");
