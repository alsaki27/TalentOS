const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');

async function run() {
  const envFile = fs.readFileSync('.env.local', 'utf-8');
  const dbUrl = envFile.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/\r/g, '').replace(/"/g, '').replace(/'/g, '');
  
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    const keys = await pool.query("SELECT provider, is_enabled FROM ai_api_keys WHERE provider = 'google_vertex_proxy'");
    console.log('AI Keys:', keys.rows);

    const routes = await pool.query("SELECT automation_id, provider, is_enabled FROM ai_automation_routes WHERE automation_id IN ('job_ceo_orchestrator', 'application_hiring_panel')");
    console.log('Routes:', routes.rows);

  } catch (err) {
    console.error('Error executing SQL:', err);
  } finally {
    await pool.end();
  }
}
run();
