import { queryOne, query } from './src/server/db/neon';

async function checkRun() {
  try {
    const run = await queryOne("SELECT * FROM job_ceo_runs WHERE id = '2e9e0a65-c5bd-49d3-984f-6ec92a8fc4e3'");
    console.log('RUN:', run);
    
    const counts = await query("SELECT stage, count(*) FROM job_ceo_staging WHERE run_id = '2e9e0a65-c5bd-49d3-984f-6ec92a8fc4e3' GROUP BY stage");
    console.log('STAGING COUNTS:', counts);
  } catch (err) {
    console.error(err);
  }
}

checkRun();
