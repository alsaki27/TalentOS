// services/google-vertex-proxy/index.js
// Minimal Cloud Run proxy for Google Vertex AI Gemini.
// Uses Application Default Credentials (Cloud Run service identity).
// No API key. No service account JSON file.

const express = require("express");
const { GoogleAuth } = require("google-auth-library");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ─── Config from env ───
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
const MODEL = process.env.GOOGLE_VERTEX_MODEL || "gemini-2.5-flash-lite";
const FALLBACK_MODEL = process.env.GOOGLE_VERTEX_FALLBACK_MODEL || "gemini-2.5-flash";
const PROXY_SECRET = process.env.GOOGLE_VERTEX_PROXY_SECRET;

// ─── Logging helpers (never log secrets) ───
function logInfo(msg, meta = {}) {
  console.log(JSON.stringify({ level: "info", message: msg, ...meta, timestamp: new Date().toISOString() }));
}
function logError(msg, meta = {}) {
  console.error(JSON.stringify({ level: "error", message: msg, ...meta, timestamp: new Date().toISOString() }));
}

// ─── Auth: ADC via Cloud Run service identity ───
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  const token =
    typeof tokenResponse === "string"
      ? tokenResponse
      : tokenResponse?.token;

  if (!token || typeof token !== "string") {
    throw new Error("ADC returned no access token");
  }

  return token;
}

// ─── Helpers ───
function checkSecret(req) {
  const secret = req.headers["x-proxy-secret"];
  if (!PROXY_SECRET) return true; // if no secret configured, allow (dev only)
  return secret === PROXY_SECRET;
}

function roughTokenEstimate(text) {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

function buildVertexBody(body, model) {
  const { system, messages, temperature = 0.2, maxOutputTokens = 1500, responseMimeType } = body;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : m.content.map((c) => c.text || "").join("\n") }],
  }));

  const generationConfig = {
    temperature,
    maxOutputTokens,
  };

  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }

  const vertexBody = {
    contents,
    generationConfig,
  };

  if (system) {
    vertexBody.systemInstruction = {
      parts: [{ text: system }],
    };
  }

  return vertexBody;
}

// ─── Routes ───

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "google-vertex-proxy" });
});

app.post("/generate", async (req, res) => {
  const start = Date.now();

  // 1. Validate secret
  if (!checkSecret(req)) {
    logError("Unauthorized request: invalid or missing x-proxy-secret", { ip: req.ip });
    return res.status(401).json({ ok: false, error: "Unauthorized. Invalid or missing x-proxy-secret header." });
  }

  // 2. Validate request body
  const { messages, model: requestedModel } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: "Bad request. 'messages' array is required." });
  }

  const model = requestedModel || MODEL;
  const vertexUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;

  // 3. Get access token via ADC (Cloud Run service identity)
  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    logError("Failed to get ADC access token", { error: err.message });
    return res.status(502).json({ ok: false, error: "Failed to authenticate with Vertex AI." });
  }

  // 4. Call Vertex AI
  const vertexBody = buildVertexBody(req.body, model);
  let vertexRes;
  try {
    vertexRes = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(vertexBody),
    });
  } catch (err) {
    logError("Vertex AI request failed", { error: err.message, model });
    return res.status(502).json({ ok: false, error: "Vertex AI request failed." });
  }

  // 5. Handle Vertex errors
  if (!vertexRes.ok) {
    const safeErrorText = await vertexRes.text().catch(() => "");
    logError("Vertex AI returned error", {
      status: vertexRes.status,
      model,
      // Sanitize: strip any token-like strings, limit to 1000 chars
      details: safeErrorText
        .replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
        .slice(0, 1000),
    });

    if (vertexRes.status === 429) {
      return res.status(429).json({
        ok: false,
        error: "Rate limit or quota exceeded.",
      });
    }
    if (vertexRes.status >= 500) {
      return res.status(502).json({
        ok: false,
        error: "Vertex AI failed.",
        status: vertexRes.status,
        details: safeErrorText.slice(0, 1000),
      });
    }
    return res.status(502).json({
      ok: false,
      error: "Vertex AI error",
      status: vertexRes.status,
      details: safeErrorText.slice(0, 1000),
    });
  }

  // 6. Parse response
  let data;
  try {
    data = await vertexRes.json();
  } catch (err) {
    logError("Failed to parse Vertex AI response", { error: err.message });
    return res.status(502).json({ ok: false, error: "Invalid response from Vertex AI." });
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    logError("Vertex AI returned no candidates");
    return res.status(502).json({ ok: false, error: "Vertex AI returned no content." });
  }

  const text = candidate.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
  const usage = data.usageMetadata || {};
  const latencyMs = Date.now() - start;

  logInfo("Request completed", {
    model,
    latencyMs,
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  });

  // 7. Return clean response
  res.json({
    ok: true,
    provider: "google_vertex_proxy",
    model,
    text,
    usage: {
      inputTokens: usage.promptTokenCount ?? roughTokenEstimate(JSON.stringify(vertexBody)),
      outputTokens: usage.candidatesTokenCount ?? roughTokenEstimate(text),
      totalTokens: usage.totalTokenCount ?? (roughTokenEstimate(JSON.stringify(vertexBody)) + roughTokenEstimate(text)),
    },
  });
});

// ─── Global error handler ───
app.use((err, _req, res, _next) => {
  logError("Unhandled error", { error: err.message });
  res.status(500).json({ ok: false, error: "Internal server error." });
});

// ─── Start ───
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logInfo(`Google Vertex Proxy listening on port ${PORT}`, { project: PROJECT, location: LOCATION, model: MODEL });
});
