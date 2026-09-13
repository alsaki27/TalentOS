// Regression coverage for the fix to the recurring Google/LinkedIn Job Agent
// run failures ("Dataset processing lease expired after 30 minutes", "Run
// timed out — automatically marked failed after 120 minutes"). None of the
// outbound Apify fetch calls had a timeout, so a stalled response could hang
// the whole cron invocation indefinitely - the platform would eventually
// kill it with no chance for our own try/catch to run, orphaning the run
// with no real error recorded until a much later watchdog cleaned it up.
// fetchApify() (jobAgentService.ts) now bounds every one of those calls with
// an AbortController and throws a specific, immediately-catchable error
// instead.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Simulates a real fetch() that respects an AbortSignal: never resolves on
// its own, but rejects with a DOMException("AbortError") the instant the
// signal fires - exactly what a genuinely stalled network request does once
// AbortController.abort() is called.
function neverResolvingFetch(): typeof fetch {
  return vi.fn((_url: any, init?: any) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
}

describe("jobAgentService Apify calls — timeout handling", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("checkApifyRunStatus fails fast with a specific error instead of hanging past its timeout", async () => {
    global.fetch = neverResolvingFetch();
    const { checkApifyRunStatus } = await import("@/server/services/jobAgentService");

    const promise = checkApifyRunStatus("run-123", "token-abc");
    const assertion = expect(promise).rejects.toThrow(/timed out after 20000ms/);

    // Advance past the 20s status-check timeout - if fetchApify() didn't
    // wire the AbortController up correctly, this promise would never
    // settle and the test would hang/timeout instead of failing cleanly.
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("a dataset fetch that never responds is reported as a timeout, not left hanging", async () => {
    global.fetch = neverResolvingFetch();
    const jobAgentService = await import("@/server/services/jobAgentService");

    const promise = jobAgentService.fetchLiveApifyDatasetItems("dataset-123", "token-abc", 50);
    const assertion = expect(promise).rejects.toThrow(/timed out after 20000ms/);

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("a real response before the timeout resolves normally (no false-positive timeouts)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "SUCCEEDED" } }),
    }) as unknown as typeof fetch;
    const { checkApifyRunStatus } = await import("@/server/services/jobAgentService");

    const status = await checkApifyRunStatus("run-123", "token-abc");
    expect(status).toBe("SUCCEEDED");
  });
});
