import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const requiredTables = [
  "profiles",
  "candidates",
  "jobs",
  "applications",
  "resumes",
  "application_events",
  "audit_logs",
];

function loadEnvFile(path) {
  if (!existsSync(path)) return null;
  const values = {};
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

function isPlaceholder(name, value) {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return (
    normalized.includes("your-") ||
    normalized.includes("your_") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized === "sk_test_..." ||
    normalized === "pk_test_..." ||
    (name === "SUPABASE_URL" && !normalized.startsWith("https://")) ||
    (name.includes("KEY") && value.length < 20)
  );
}

function printFailure(title, items) {
  console.log(`\n${title}`);
  for (const item of items) console.log(`- ${item}`);
}

const env = loadEnvFile(envPath);
const failures = [];

console.log("TalentOS setup check");
console.log("====================");

if (!env) {
  failures.push(".env.local is missing.");
} else {
  console.log("Found .env.local.");
}

const missing = [];
const placeholders = [];
if (env) {
  for (const name of requiredEnv) {
    const value = env[name];
    if (!value) missing.push(name);
    else if (isPlaceholder(name, value)) placeholders.push(name);
  }
}

if (missing.length) failures.push(`Missing required env vars: ${missing.join(", ")}.`);
if (placeholders.length) failures.push(`Replace placeholder values for: ${placeholders.join(", ")}.`);

let supabase = null;
if (env && !missing.length && !placeholders.length) {
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });

  const { error } = await supabase.from("profiles").select("user_id", { head: true, count: "exact" });
  if (error) {
    failures.push(`Could not connect to Supabase or query profiles: ${error.message}`);
  } else {
    console.log("Connected to Supabase.");
  }
}

if (supabase) {
  const missingTables = [];
  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select("*", { head: true, count: "exact" });
    if (error) missingTables.push(`${table} (${error.message})`);
  }
  if (missingTables.length) {
    failures.push(`Required tables are missing or unavailable: ${missingTables.join("; ")}.`);
  } else {
    console.log("Required core tables exist.");
  }
}

if (failures.length) {
  printFailure("Setup check failed:", failures);
  console.log("\nNext steps:");
  console.log("1. Copy .env.example to .env.local if the file is missing.");
  console.log("2. Fill Supabase values from Supabase Dashboard > Project Settings > API.");
  console.log("3. Apply database migrations with: npx supabase db push");
  console.log("4. Create the first Auth user in Supabase Authentication, then run: npm run seed:admin");
  process.exit(1);
}

console.log("\nSetup check passed.");
console.log("Next: create a Supabase Auth user if needed, run npm run seed:admin, then npm run dev.");
