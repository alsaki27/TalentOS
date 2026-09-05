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

function openAiMessagesToGeminiContents(messages) {
  return messages
    .filter((message) => message && message.role !== "system")
    .map((message) => {
      const content = Array.isArray(message.content)
        ? message.content
            .map((part) => typeof part === "string" ? part : part?.text)
            .filter(Boolean)
            .map((text) => ({ text: String(text) }))
        : [{ text: String(message.content ?? "") }];
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: content,
      };
    })
    .filter((message) => message.parts.length > 0);
}

function openAiToolsToGeminiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  if (tools.some((tool) => Array.isArray(tool?.functionDeclarations))) return tools;
  const functionDeclarations = tools
    .filter((tool) => tool?.type === "function" && tool.function)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  return functionDeclarations.length ? [{ functionDeclarations }] : undefined;
}

function geminiResponseToOpenAi(responseText, model) {
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    return responseText;
  }
  if (!Array.isArray(data.candidates)) return responseText;

  const parts = data.candidates[0]?.content?.parts ?? [];
  const text = parts.filter((part) => typeof part.text === "string").map((part) => part.text).join("\n");
  const toolCalls = parts
    .filter((part) => part.functionCall?.name)
    .map((part, index) => ({
      id: `vertex_call_${index}`,
      type: "function",
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args ?? {}),
      },
    }));
  const finishReason = toolCalls.length
    ? "tool_calls"
    : data.candidates[0]?.finishReason === "MAX_TOKENS" ? "length" : "stop";
  const usage = data.usageMetadata
    ? {
        prompt_tokens: data.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;

  return JSON.stringify({
    id: `vertex-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    ...(usage ? { usage } : {}),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, projectId, location });
    }

    if (req.method !== "POST" || req.url !== "/generate") {
      return json(res, 404, { error: "Not found" });
    }
    const authorization = String(req.headers.authorization || "");
    const bearerSecret = authorization.replace(/^Bearer\s+/i, "");
    const suppliedSecret = req.headers["x-proxy-secret"] || bearerSecret;
    if (!secretMatches(suppliedSecret)) {
      return json(res, 401, { error: "Unauthorized" });
    }

    const input = await readJson(req);
    const model = String(input.model || "gemini-2.5-flash-lite");
    if (!/^gemini-[a-z0-9._-]+$/i.test(model)) {
      return json(res, 400, { error: "Unsupported model name" });
    }
    const contents = Array.isArray(input.contents) && input.contents.length > 0
      ? input.contents
      : openAiMessagesToGeminiContents(input.messages ?? []);
    if (contents.length === 0) return json(res, 400, { error: "messages or contents must be non-empty" });

    const systemMessage = Array.isArray(input.messages)
      ? input.messages.find((message) => message?.role === "system")?.content
      : undefined;
    const system = input.system ?? (typeof systemMessage === "string" ? systemMessage : undefined);
    const tools = openAiToolsToGeminiTools(input.tools);

    const generationConfig = {};
    if (Number.isFinite(input.temperature)) generationConfig.temperature = input.temperature;
    if (Number.isInteger(input.maxOutputTokens)) generationConfig.maxOutputTokens = input.maxOutputTokens;
    if (Number.isInteger(input.max_tokens)) generationConfig.maxOutputTokens = input.max_tokens;
    if (input.responseMimeType && !tools) generationConfig.responseMimeType = input.responseMimeType;
    if (input.response_format && !tools) generationConfig.responseMimeType = "application/json";

    const vertexBody = {
      contents,
      ...(system
        ? { systemInstruction: { parts: [{ text: String(system) }] } }
        : {}),
      ...(tools ? { tools } : {}),
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
    if (response.ok) return json(res, response.status, JSON.parse(geminiResponseToOpenAi(responseText, model)));
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
