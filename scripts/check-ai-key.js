const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');

async function run() {
  const envFile = fs.readFileSync('.env.local', 'utf-8');
  const dbUrl = envFile.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/\r/g, '').replace(/"/g, '').replace(/'/g, '');
  
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    const keys = await pool.query("SELECT id, provider, label, encrypted_key, is_enabled FROM ai_api_keys WHERE provider = 'google_vertex_proxy'");
    console.log('AI Keys:', keys.rows);
  } catch (err) {
    console.error('Error executing SQL:', err);
  } finally {
    await pool.end();
  }
}
run();
