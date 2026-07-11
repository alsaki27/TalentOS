import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

const appId = "77bb468e-1af5-424d-8444-2908551e56dc";

// Delete orphaned stage runs, artifacts, then workflow
await c.query("DELETE FROM application_ai_stage_runs WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_artifacts WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_workflows WHERE application_id = $1", [appId]);

const remaining = await c.query("SELECT id FROM application_ai_workflows WHERE application_id = $1", [appId]);
console.log("Cleaned up. Remaining workflows:", remaining.rows.length);

await c.end();
