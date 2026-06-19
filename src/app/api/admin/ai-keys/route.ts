// src/app/api/admin/ai-keys/route.ts
// GET -> list all AI API keys (metadata only, never decrypted keys)
// POST -> add a new AI API key

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import {
  listAiKeys,
  createAiKey,
  type AiProvider,
} from "@/server/repositories/aiKeyRepository";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const keys = await listAiKeys();
    return NextResponse.json({ keys });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  if (!isEncryptionAvailable()) {
    return NextResponse.json(
      {
        error: "AI key encryption is not configured. Set AI_KEYS_ENCRYPTION_SECRET in your environment to add API keys.",
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider as AiProvider;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const priority = typeof body.priority === "number" ? body.priority : 100;
  const isEnabled = body.isEnabled !== false;

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  const validProviders = [
    "anthropic", "nvidia", "openai", "google", "groq", "openrouter", "deepseek", "local",
  ];
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 });
  }

  try {
    const key = await createAiKey({
      provider,
      label,
      apiKey,
      priority,
      isEnabled,
      createdBy: context?.profile.user_id,
    });

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "create",
      description: `Added AI API key: ${label} (${provider})`,
      entityType: "ai_api_key",
      entityId: key.id,
      entityName: label,
      metadata: { provider, priority, fingerprint: key.key_fingerprint },
    });

    return NextResponse.json({ key }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
