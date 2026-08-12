import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const projectId = process.env.VERTEX_PROJECT_ID;
const location = process.env.VERTEX_LOCATION || "global";
const proxySecret = process.env.PROXY_SECRET;
const maxBodyBytes = 2 * 1024 * 1024;

if (!projectId || !proxySecret) {
  throw new Error("VERTEX_PROJECT_ID and PROXY_SECRET are required");
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function secretMatches(candidate = "") {
  const expected = Buffer.from(proxySecret);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function accessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error(`ADC token failed (${response.status})`);
  return (await response.json()).access_token;
}

function vertexEndpoint(model) {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, projectId, location });
    }

    if (req.method !== "POST" || req.url !== "/generate") {
      return json(res, 404, { error: "Not found" });
    }
    if (!secretMatches(req.headers["x-proxy-secret"])) {
      return json(res, 401, { error: "Unauthorized" });
    }

    const input = await readJson(req);
    const model = String(input.model || "gemini-2.5-flash-lite");
    if (!/^gemini-[a-z0-9._-]+$/i.test(model)) {
      return json(res, 400, { error: "Unsupported model name" });
    }
    if (!Array.isArray(input.contents) || input.contents.length === 0) {
      return json(res, 400, { error: "contents must be a non-empty array" });
    }

    const generationConfig = {};
    if (Number.isFinite(input.temperature)) generationConfig.temperature = input.temperature;
    if (Number.isInteger(input.maxOutputTokens)) generationConfig.maxOutputTokens = input.maxOutputTokens;
    if (input.responseMimeType && !input.tools) generationConfig.responseMimeType = input.responseMimeType;

    const vertexBody = {
      contents: input.contents,
      ...(input.system
        ? { systemInstruction: { parts: [{ text: String(input.system) }] } }
        : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    };

    const response = await fetch(vertexEndpoint(model), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(vertexBody),
    });
    const responseText = await response.text();
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(responseText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected proxy error";
    if (message === "REQUEST_TOO_LARGE") return json(res, 413, { error: "Request too large" });
    if (error instanceof SyntaxError) return json(res, 400, { error: "Invalid JSON" });
    console.error(message);
    return json(res, 500, { error: "Vertex proxy request failed" });
  }
});

server.listen(port, () => {
  console.log(`TalentOS Vertex proxy listening on ${port}`);
});
