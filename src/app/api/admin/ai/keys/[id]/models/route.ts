import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { sanitizeApiError } from "@/lib/utils";
import { getAiKeyWithDecryptedKey } from "@/server/repositories/aiKeyRepository";
import { PROVIDER_MODEL_PRESETS } from "@/lib/ai/providerPresets";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const key = await getAiKeyWithDecryptedKey(params.id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const discovered = Array.isArray((key as any).available_models) ? (key as any).available_models : [];
    const presets = (PROVIDER_MODEL_PRESETS[key.provider] || []).map((p) => ({
      ...p,
      source: "preset" as const,
    }));

    const seen = new Set<string>();
    const merged = [
      ...discovered.map((m: any) => ({ ...m, source: m.source || ("provider" as const) })),
      ...presets,
    ].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    return NextResponse.json({
      models: merged,
      default_model: (key as any).default_model || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
