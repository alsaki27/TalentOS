const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').find(line => line.startsWith('DATABASE_URL=')).split('=')[1].trim().replace(/^"|"$/g, '');
const { neon } = require('@neondatabase/serverless');
const sql = neon(env);
async function run() {
  const result = await sql`SELECT category_error FROM jobs WHERE id = '1c92ba40-0703-466f-b7e9-dd259e86d04f'`;
  console.log(result);
}
run();
