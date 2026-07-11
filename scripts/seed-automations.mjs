import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// Seed the 4 agent automations
const agents = [
  ['application_job_lens', 'Job Lens', 'Analyze the JD and extract requirements', 'Agent Pipeline'],
  ['application_resume_forge', 'Resume Forge', 'Produce an evidence-supported tailored draft', 'Agent Pipeline'],
  ['application_hiring_panel', 'Hiring Panel', 'Grade as recruiter, HR manager, and ATS', 'Agent Pipeline'],
  ['application_final_polish', 'Final Polish', 'Apply approved feedback and run final QA', 'Agent Pipeline'],
];

for (const [id, label, desc, group] of agents) {
  await c.query(
    `INSERT INTO ai_automations (id, label, description, group_label)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [id, label, desc, group]
  );
  console.log(`✓ Seeded: ${id} (${label})`);
}

// Now add routes for all 4 agents + chat_assistant pointing to the Google key
const keyRow = await c.query(`SELECT id FROM ai_api_keys WHERE label = 'Rianv1' LIMIT 1`);
if (keyRow.rows[0]) {
  for (const agentId of ['application_job_lens', 'application_resume_forge', 'application_hiring_panel', 'application_final_polish', 'chat_assistant']) {
    await c.query(`DELETE FROM ai_automation_routes WHERE automation_id = $1`, [agentId]);
    await c.query(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled)
       VALUES ($1, $2, 1, true)`,
      [agentId, keyRow.rows[0].id]
    );
    console.log(`✓ Route: ${agentId} -> Rianv1`);
  }
}

await c.end();
console.log("\nDone.");
