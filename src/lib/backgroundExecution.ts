// src/lib/backgroundExecution.ts
// Platform-agnostic helper to keep work alive after a Next.js Response is sent.
// Cloudflare: uses waitUntil. Node.js: uses setImmediate/setTimeout fallback.

import { NextRequest } from "next/server";

function findWaitUntil(req?: NextRequest): ((promise: Promise<unknown>) => void) | null {
  const anyReq = req as any;
  const anyGlobal = globalThis as any;
  if (typeof anyReq?.waitUntil === "function") return (p) => anyReq.waitUntil(p);
  if (typeof anyReq?.ctx?.waitUntil === "function") return (p) => anyReq.ctx.waitUntil(p);
  if (typeof anyGlobal?.cloudflare?.waitUntil === "function") return (p) => anyGlobal.cloudflare.waitUntil(p);
  if (typeof anyGlobal?.waitUntil === "function") return (p) => anyGlobal.waitUntil(p);
  return null;
}

export function runInBackground(
  req: NextRequest | undefined,
  work: () => Promise<void>
): void {
  const waitUntil = findWaitUntil(req);

  if (waitUntil) {
    waitUntil(work().catch((err) => console.error("[backgroundExecution] failed:", (err as Error).message)));
    return;
  }

  // Node.js fallback — schedule work after response via the event loop.
  // This ensures the work runs even though the route handler has already returned.
  const id = setTimeout(() => {
    work().catch((err) => console.error("[backgroundExecution] work failed:", (err as Error).message));
  }, 10);
  // Keep the process alive — unref would let the process exit, so we don't call it.
  // The timer reference keeps the event loop active until work completes.
  if (typeof id === "object" && "unref" in id) {
    // TypeScript: setTimeout returns NodeJS.Timeout in Node, number in browser
    (id as any).unref?.();
    // Actually DON'T unref — we want the event loop to stay alive until work finishes.
  }
}

export function canRunInBackground(req?: NextRequest): boolean {
  return !!findWaitUntil(req);
}