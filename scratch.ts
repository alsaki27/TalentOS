import { execute } from './src/server/db/neon';
async function run() {
  console.log('Deleting jobs...');
  try {
    const res = await execute("DELETE FROM jobs WHERE description_text IS NULL OR LENGTH(TRIM(description_text)) < 30");
    console.log('Deleted rows:', res.rowCount);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
run();
