import { Client } from '@neondatabase/serverless';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);
const sql = fs.readFileSync('sql/neon_fixes/037_fix_vertex_key_encryption.sql', 'utf8');

async function applySql() {
  const c = new Client(DB_URL);
  await c.connect();
  console.log('Applying 037_fix_vertex_key_encryption.sql...');
  await c.query(sql);
  console.log('Applied successfully.');
  
  const keys = await c.query(`SELECT provider, encrypted_key FROM ai_api_keys WHERE provider = 'google_vertex_proxy'`);
  console.log('Keys:', keys.rows);
  
  await c.end();
}
applySql().catch(console.error);
