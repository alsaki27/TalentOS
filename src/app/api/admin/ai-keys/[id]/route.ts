// src/app/api/admin/ai-keys/[id]/route.ts
// PATCH -> update label, priority, is_enabled, or replace apiKey
// DELETE -> soft-disable (set is_enabled=false, status='disabled')

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import {
  updateAiKey,
  disableAiKey,
  listAiKeys,
} from "@/server/repositories/aiKeyRepository";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: {
    label?: string;
    model?: string | null;
    priority?: number;
    is_enabled?: boolean;
    apiKey?: string;
  } = {};

  if (body.label !== undefined) updates.label = body.label;
  if (body.model !== undefined) updates.model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.is_enabled !== undefined) updates.is_enabled = body.is_enabled;
  if (body.apiKey !== undefined) {
    if (!isEncryptionAvailable()) {
      return NextResponse.json(
        { error: "AI key encryption is not configured. Set AI_KEYS_ENCRYPTION_SECRET to replace API keys." },
        { status: 503 }
      );
    }
    updates.apiKey = body.apiKey;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const key = await updateAiKey(id, updates);

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "update",
      description: `Updated AI API key: ${key.label}`,
      entityType: "ai_api_key",
      entityId: key.id,
      entityName: key.label,
      metadata: { provider: key.provider, priority: key.priority, enabled: key.is_enabled },
    });

    return NextResponse.json({ key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    const key = await disableAiKey(id);

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "delete",
      description: `Disabled AI API key: ${key.label}`,
      entityType: "ai_api_key",
      entityId: key.id,
      entityName: key.label,
      metadata: { provider: key.provider },
    });

    return NextResponse.json({ key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
