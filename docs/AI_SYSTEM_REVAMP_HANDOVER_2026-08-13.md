# TalentOS AI system revamp handover

Date: 2026-08-13 (America/New_York)

## Objective

Make Neon and the AI Control Center the single, inspectable control plane for provider credentials, endpoints, model routing, workflow concurrency, and routing-state activation. GitHub Actions and Cloudflare deployment secrets must not select or override an AI provider.

The only remaining runtime bootstrap secret is `AI_KEYS_ENCRYPTION_SECRET`. It is not an AI-provider credential. It decrypts provider credentials stored in Neon and therefore must remain outside the same database. A future hardening phase can replace it with Cloud KMS, but storing it beside its ciphertext would defeat encryption.

## Problems found

1. The Vertex database row was not self-contained. Runtime depended on deployment-level provider settings, so Control Center data could disagree with production.
2. Provider-only routes tried environment providers before Neon keys. Old deployment secrets could silently override an admin's route configuration.
3. Published routing states were documentation only. Runtime still read the mutable `ai_automation_routes` table, and multiple states could appear published without one explicit active pointer.
4. OpenCode's key-level default was `deepseek/deepseek-v4-flash`, while the configured gateway accepts `deepseek-v4-flash`. Direct tests returned HTTP 403.
5. Placeholder rows for the legacy Vertex and direct OpenCode environment paths remained enabled.
6. Rate-limited/quota statuses acted as permanent circuit breakers until a human retested a key.
7. Server/timeout/model-route failures could blacklist too broadly or hide the concrete provider error behind “all routes failed.”
8. Workflow claims expired after two minutes while agent timeouts can be five minutes. A valid long call could be reclaimed, duplicated, and eventually marked failed as an orphan.
9. Retry/restart paths did not comprehensively release old workflow claims.
10. Candidate Source of Truth had direct Vertex/Google environment calls and was not represented as an automation in Control Center.
11. Secret encryption could silently fall back to plaintext if the encryption bootstrap was absent.
12. Legacy Vertex JSON compatibility converted an explicit `responseMimeType: null` back to JSON mode.

## Implemented architecture

### Provider connections

- `ai_api_keys` remains the encrypted credential store.
- `provider_config jsonb` stores non-secret operational metadata such as Google Cloud project, Vertex location, service account identity, Cloud Run service/region, health/chat/embeddings URLs, Secret Manager resource reference, model alias resolution, and embedding model.
- `base_url` plus `chat_endpoint` are now used directly by the Vertex adapter.
- Provider adapters receive credentials and endpoints explicitly. They no longer read provider API keys or model choices from deployment environment variables.
- The Control Center can add and edit a complete connection, including replacing the encrypted credential without exposing the existing value.
- Encryption now fails closed; it never stores plaintext when the bootstrap secret is unavailable.

### Routing

- `ai_runtime_config` is a singleton runtime policy row.
- `active_routing_state_id` explicitly selects one immutable routing snapshot.
- Publishing a state archives the previous published state and atomically activates the new one.
- Runtime first resolves the active state's route for an automation. A live-table route is used only if the active snapshot does not yet contain a newly added automation.
- Exact-key routes resolve only the named Neon key and route model.
- Provider-only routes resolve enabled Neon keys for that provider; environment credentials are not considered.
- Optional emergency fallback is controlled by `ai_runtime_config.allow_unrouted_fallback` and remains Neon-only.
- A draft state named `NEON HYBRID 8.13` contains two exact-key routes for all 45 active automations: task-specific OpenCode primary and `coding-cheap` Vertex fallback.

### Failure handling

- Every routed success/failure updates key health as well as `ai_usage_events`.
- Rate-limit and quota states cool down after 15 minutes instead of disabling a provider forever.
- Auth/rate failures blacklist the key for the current call. Timeout, 404, 5xx, and model-configuration failures blacklist only the failed route/model, allowing another model on the same gateway.
- The real provider error is preserved when no later route can resolve.
- OpenCode's default model identifier was normalized to the gateway's accepted alias.

### Workflow state machine

- Concurrency and claim TTL are database-controlled (`5` concurrent, `420` seconds by default).
- Long AI calls refresh the workflow heartbeat every 60 seconds.
- Queue, completion, cancellation, and failure transitions release claim metadata.
- Retry/restart therefore do not carry stale claim leases.
- Candidate Source of Truth is now the `candidate_source_of_truth` automation and uses the same tracked route resolver as every other AI feature.

## Vertex connection now represented in Neon

The `Skarion CRM Vertex Gateway` row contains:

- Google Cloud project and location
- Cloud Run service, region, base URL, health URL, chat URL, and embeddings URL
- service-account identity and Secret Manager resource reference
- chat alias `coding-cheap`, resolving to `gemini-3.5-flash-lite`
- embedding model `text-embedding-004`

The live credential itself must be written through the authenticated production Control Center/API so the production `AI_KEYS_ENCRYPTION_SECRET` encrypts it. Never place the credential in a migration, repository file, log, or `provider_config`.

## Database snapshot during audit

- 45 active automations; 0 lacked a live route; 0 are missing from the new hybrid draft.
- 909 historical application workflows completed.
- 143 historical workflows were failed (75 stage 0, 23 stage 1, 35 stage 2, 10 stage 3) at the audit snapshot.
- One workflow was actively running and had a live lease; none had an expired running claim.
- All four AI key rows had an `enc:` prefix, but two were explicit environment-placeholder rows and were disabled.
- The prior 24-hour usage log contained extremely high retry amplification, including hundreds of repeated rate-limit/auth/not-found failures. The exact-state resolver, scoped route exclusion, cooldown, and longer claims are intended to stop that amplification.

## Deployment and cutover checklist

1. Apply migrations `077` and `078` (already applied to the supplied Neon database during this work).
2. Deploy the code containing the Neon-backed resolver.
3. In production Control Center, edit `Skarion CRM Vertex Gateway` and replace its credential with the live gateway API key. This encrypts it with the existing production bootstrap.
4. Run the key test. Expected gateway model response: `gemini-3.5-flash-lite` through alias `coding-cheap`.
5. Test the OpenCode connection after its default-model normalization.
6. Activate `NEON HYBRID 8.13` only after both connection tests pass.
7. Run one low-risk automation, then one application workflow through all four stages.
8. Verify `ai_usage_events.ai_key_id`, model, route rank, outcome, latency, and workflow/application IDs.
9. Observe for at least one claim TTL: no duplicate stage run, no orphan recovery, no generic route error replacing a concrete upstream error.
10. Keep old deployment AI secrets temporarily for rollback, but they are no longer read. Remove them after the observation window.

## Recommended next phase

- Add per-key circuit-breaker timestamps and exponential backoff rather than deriving cooldown from `last_failure_at`.
- Add route-state validation before activation: every active automation covered, enabled keys only, no placeholder fingerprint, supported model catalog, and successful health test within a configurable window.
- Add an activation audit table with before/after state, actor, reason, and rollback state.
- Add per-agent SLO dashboards: success rate, p50/p95 latency, tokens, cost, validation rejection rate, and workflow conversion to export-ready.
- Split provider transport errors from agent-output validation errors in a first-class error taxonomy.
- Add canary rollout percentages so a state can receive 5%, 25%, then 100% of calls.
- Add separate chat and embedding route types when embeddings are introduced.
- Replace the single encryption bootstrap with Cloud KMS envelope encryption and key rotation.
- Add retention/aggregation for `ai_usage_events`; the current retry storm produced enough rows to distort operational views.
