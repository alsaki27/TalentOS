import { query } from './src/server/db/neon';

async function main() {
  const res = await query("SELECT created_at, data FROM application_ai_artifacts WHERE automation_id = 'application_resume_forge' ORDER BY created_at DESC LIMIT 1");
  console.log("Created at:", res[0].created_at);
  console.log(JSON.stringify(res[0].data.skills, null, 2));
}

main().catch(console.error);
