// Paste into DevTools Console while logged in as admin on /admin/ai.
// Creates the mwapi.dev Anthropic-compatible key and routes
// application_resume_forge to it as primary (rank 1), keeping the two
// existing routes as fallbacks (rank 2, 3). No other agent is touched.
(async () => {
  const RAW_KEY = "sk-8d93daf176120224019f094af52fac08db632a6e7f26b6b430cd36243125e2a1";

  // 1. Create the key.
  const createRes = await fetch("/api/admin/ai/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "anthropic",
      label: "MWAPI Anthropic Proxy (Resume Forge)",
      apiKey: RAW_KEY,
      model: "claude-sonnet-5",
      base_url: "https://api.mwapi.dev",
      chat_endpoint: "/v1/messages",
      provider_mode: "anthropic_compatible",
      api_style: "anthropic_messages",
      priority: 50,
      isEnabled: true,
    }),
  });
  const createData = await createRes.json();
  console.log("1) Create key ->", createRes.status, createData);
  if (!createRes.ok || !createData.key?.id) {
    console.error("ABORTING — key creation failed, routes untouched.");
    return;
  }
  const newKeyId = createData.key.id;
  console.log(`   Key created: id=${newKeyId}, live test =`, createData.test, ", autoEnabled =", createData.autoEnabled);

  // 2. Fetch current resume-forge routes.
  const getRes = await fetch("/api/admin/ai/agents/application_resume_forge/routes");
  const getData = await getRes.json();
  console.log("2) Current routes ->", getRes.status, getData);
  const existing = (getData.routes ?? []).sort((a, b) => a.rank - b.rank);

  // 3. Rebuild the route list: new key at rank 1, existing routes shifted down.
  const newRoutes = [
    { ai_key_id: newKeyId, model_override: "claude-sonnet-5", rank: 1 },
    ...existing.map((r, i) => ({ ai_key_id: r.ai_key_id, model_override: r.model_override, rank: i + 2 })),
  ];

  const putRes = await fetch("/api/admin/ai/agents/application_resume_forge/routes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routes: newRoutes, routeVersion: getData.routeVersion }),
  });
  const putData = await putRes.json();
  console.log("3) Update routes ->", putRes.status, putData);
  if (putRes.ok) {
    console.log("DONE. application_resume_forge now routes to mwapi.dev first, falling back to:",
      (putData.routes ?? []).map(r => `rank ${r.rank}: ${r.key_label} (${r.model_override})`));
  } else {
    console.error("Route update FAILED — key was created but resume-forge routing was not changed.");
  }
})();
