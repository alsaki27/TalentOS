import { Client } from '@neondatabase/serverless';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);

async function check() {
  const c = new Client(DB_URL);
  await c.connect();
  const autos = await c.query(SELECT id FROM ai_automations WHERE id IN ('job_autofill', 'jd_analysis'));
  console.log('Automations:', autos.rows);
  const routes = await c.query(SELECT * FROM ai_automation_routes WHERE automation_id IN ('job_autofill', 'jd_analysis'));
  console.log('Routes:', routes.rows);
  await c.end();
}
check();
