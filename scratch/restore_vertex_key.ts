import { Client } from '@neondatabase/serverless';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);

async function run() {
  const c = new Client(DB_URL);
  await c.connect();
  
  // Update the row to exactly match what the SQL file says
  await c.query(`
    UPDATE ai_api_keys 
    SET encrypted_key = 'enc:placeholder-env-managed',
        key_fingerprint = 'env-managed',
        label = 'Google Vertex (Proxy)',
        provider_mode = 'native',
        is_protected = true
    WHERE provider = 'google_vertex_proxy'
  `);
  
  const keys = await c.query(`SELECT id, label, provider, encrypted_key, key_fingerprint FROM ai_api_keys WHERE provider = 'google_vertex_proxy'`);
  console.log('Restored Key:', keys.rows);
  
  await c.end();
}
run().catch(console.error);
