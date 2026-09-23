# Google Vertex AI Proxy

Minimal Cloud Run proxy for Google Vertex AI Gemini. Bridges TalentOS Cloudflare Worker to Vertex AI using Cloud Run service identity (no API key, no service account JSON).

## Architecture

```
TalentOS Cloudflare Worker
  → Cloud Run proxy (this service)
    → Vertex AI Gemini via REST API
      (authenticated by Cloud Run service identity / ADC)
```

## Endpoints

### `GET /health`
Returns service health status.

### `POST /generate`
Requires header: `x-proxy-secret: <GOOGLE_VERTEX_PROXY_SECRET>`

**Request body:**
```json
{
  "system": "optional system instruction",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "model": "gemini-2.5-flash-lite",
  "temperature": 0.2,
  "maxOutputTokens": 1500,
  "responseMimeType": "application/json"
}
```

**Response:**
```json
{
  "ok": true,
  "provider": "google_vertex_proxy",
  "model": "gemini-2.5-flash-lite",
  "text": "...",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0
  }
}
```

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing messages) |
| 401 | Invalid or missing `x-proxy-secret` |
| 429 | Rate limit / quota exceeded |
| 502 | Vertex AI failed |

## Deploy

```bash
gcloud run deploy skarion-gemini-proxy \
  --source services/google-vertex-proxy \
  --region us-central1 \
  --service-account skarion-gemini-api@talentos-500005.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --max-instances 2 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=talentos-500005,GOOGLE_CLOUD_LOCATION=us-central1,GOOGLE_VERTEX_MODEL=gemini-2.5-flash-lite,GOOGLE_VERTEX_FALLBACK_MODEL=gemini-2.5-flash,GOOGLE_VERTEX_PROXY_SECRET=<your-secret>
```

Replace `<your-secret>` with a strong random string. This same secret must be set in TalentOS as `GOOGLE_VERTEX_PROXY_SECRET`.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLOUD_PROJECT` | Yes | — | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | No | `us-central1` | Vertex AI region |
| `GOOGLE_VERTEX_MODEL` | No | `gemini-2.5-flash-lite` | Default model |
| `GOOGLE_VERTEX_FALLBACK_MODEL` | No | `gemini-2.5-flash` | Fallback model |
| `GOOGLE_VERTEX_PROXY_SECRET` | Yes | — | Shared secret with TalentOS |
| `PORT` | No | `8080` | Server port |

## Auth

This service uses **Application Default Credentials (ADC)**. In Cloud Run, the service account attached to the service (`skarion-gemini-api@talentos-500005.iam.gserviceaccount.com`) is used automatically. No service account JSON file, no API key, no `GOOGLE_APPLICATION_CREDENTIALS` env var needed.

The service account must have the `roles/aiplatform.user` role on the project.

## Security

- Never logs the proxy secret, access tokens, or full request/response bodies.
- Only logs metadata: latency, token counts, model name, error status.
