import { Client } from '@neondatabase/serverless';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);
const sql = fs.readFileSync('sql/neon_fixes/036_fix_automation_ids_and_routes.sql', 'utf8');

async function applySql() {
  const c = new Client(DB_URL);
  await c.connect();
  console.log('Applying 036_fix_automation_ids_and_routes.sql...');
  await c.query(sql);
  console.log('Applied successfully.');
  
  const autos = await c.query(`SELECT id FROM ai_automations WHERE id IN ('job_autofill', 'ats_extraction', 'ats_narrative', 'jd_analysis')`);
  console.log('Automations:', autos.rows);
  const routes = await c.query(`SELECT * FROM ai_automation_routes WHERE automation_id IN ('job_autofill', 'ats_extraction', 'ats_narrative', 'jd_analysis')`);
  console.log('Routes:', routes.rows);
  
  await c.end();
}
applySql().catch(console.error);
