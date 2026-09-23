import { getCloudflareContext } from "@opennextjs/cloudflare";

// Registers a background promise with the Cloudflare Workers execution
// context so it survives past the HTTP response being sent. Without this,
// every "fire-and-forget" dispatch call in the AI workflow pipeline
// (dispatchWorkflowById) is only guaranteed to run for as long as the
// Worker happens to stay alive after responding - which on Cloudflare
// Workers can be cut short at any point, silently dropping the next
// pipeline stage and leaving a workflow stuck until the 5-minute cron
// dispatcher (or a manual retry) picks it back up.
//
// getCloudflareContext() and ctx.waitUntil() are called synchronously while
// the request's execution context is still active. Callers may still use
// `await backgroundDispatch(...)` for readability; the function itself does
// not add an asynchronous delay before the route can return its response.
//
// Falls back to just letting the promise run un-awaited (the old
// behavior) when not running inside a real Cloudflare Workers request -
// e.g. local dev via `next dev`. Never throws: a failure to register with
// waitUntil should never break the caller's actual response.
export function backgroundDispatch(promise: Promise<unknown>): void {
  const suppressed = promise.catch((err) => {
    console.error(`[Dispatch Chain] backgroundDispatch promise rejected:`, err);
  });
  try {
    // The request context is installed synchronously by the Worker entrypoint.
    // Register waitUntil synchronously so callers do not delay their response
    // on an unnecessary promise turn or context lookup.
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(suppressed);
    console.log(`[Dispatch Chain] backgroundDispatch registered with ctx.waitUntil successfully.`);
  } catch (err) {
    // Not in a Cloudflare Workers context, or waitUntil registration
    // itself failed - the original promise is still running above,
    // just without the extended-lifetime guarantee.
    console.log(`[Dispatch Chain] backgroundDispatch getCloudflareContext failed (non-Worker env or registration error): ${String(err)}. Promise will run un-awaited.`);
  }
}
