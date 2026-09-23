import { query } from "../src/server/db/neon";
async function main() {
  const ids = ["a4620542-a3f9-43a2-93e7-2c9797f27c83","b0eb4be3-c118-4105-a6f2-6bd310e61e0f","5778614e-7865-4953-9071-3acc6cca5ac6","41e34171-d159-4032-b951-654bb4e1bb53","c5ba604b-fba5-4964-962b-eb065cada756","4201457a-f79a-4245-bbc7-5fec459e171b","4d3fef90-5347-4201-b138-95b1cfad4a6d","2f8aa4d5-a019-4ac9-85d2-6e3d48c39347","72af836c-ff58-4137-85ed-4ef030b70cf6","dde3b4f9-e64a-47eb-a9b6-e96d0e67ecbc"];
  const rows = await query(`SELECT id, status, current_stage, last_error, created_at FROM application_ai_workflows WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids]);
  console.table(rows.map((r:any)=>({id:r.id.slice(0,8), status:r.status, stage:r.current_stage, err: r.last_error?String(r.last_error).slice(0,60):null})));

  const backupCount = await query(`SELECT COUNT(*)::int as c FROM activity_logs WHERE type='application_backup_snapshot' AND created_at > now() - interval '1 hour'`);
  console.log("Backup rows written this session:", backupCount[0].c);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
