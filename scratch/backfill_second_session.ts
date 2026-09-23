// npx tsx --env-file=.env.local scratch/backfill_second_session.ts
const BASE_URL = "https://talent.skarion.com";
const SESSION_ID = "53de6ed1-d976-4688-80a5-debb1c8e7179";

async function main() {
  const getRes = await fetch(`${BASE_URL}/api/falood/applications?id=${SESSION_ID}`);
  const getJson: any = await getRes.json();
  if (!getJson?.success) { console.log("GET failed:", getJson); return; }

  const patchRes = await fetch(`${BASE_URL}/api/falood/applications?id=${SESSION_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeData: getJson.data.resumeData }),
  });
  const patchJson: any = await patchRes.json().catch(() => ({}));
  console.log(`PATCH HTTP ${patchRes.status}, success=${patchJson?.success}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
