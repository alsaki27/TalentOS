const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query("SELECT data FROM application_ai_artifacts WHERE automation_id = 'application_resume_forge' ORDER BY created_at DESC LIMIT 1"))
  .then(r => {
    console.log(JSON.stringify(r.rows[0].data.skills, null, 2));
    c.end();
  })
  .catch(e => {
    console.error(e);
    c.end();
  });
