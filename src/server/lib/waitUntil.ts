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
// MUST be awaited by the caller before the route handler returns its
// response. A first attempt at this used a fire-and-forget dynamic
// import().then() chain that the caller never awaited - the registration
// itself raced the response being sent and, confirmed live, never won:
// zero stage_runs were ever created for an auto-triggered workflow even
// after several minutes, worse than the plain .catch() it replaced.
// getCloudflareContext() must resolve, and ctx.waitUntil() must actually
// be called, while the request's execution context is still active -
// i.e. before the handler returns - not in a detached microtask chain
// racing the response.
//
// Falls back to just letting the promise run un-awaited (the old
// behavior) when not running inside a real Cloudflare Workers request -
// e.g. local dev via `next dev`. Never throws: a failure to register with
// waitUntil should never break the caller's actual response.
export async function backgroundDispatch(promise: Promise<unknown>): Promise<void> {
  const suppressed = promise.catch((err) => {
    console.error(`[Dispatch Chain] backgroundDispatch promise rejected:`, err);
  });
  try {
    const { ctx } = await getCloudflareContext();
    ctx.waitUntil(suppressed);
    console.log(`[Dispatch Chain] backgroundDispatch registered with ctx.waitUntil successfully.`);
  } catch (err) {
    // Not in a Cloudflare Workers context, or waitUntil registration
    // itself failed - the original promise is still running above,
    // just without the extended-lifetime guarantee.
    console.log(`[Dispatch Chain] backgroundDispatch getCloudflareContext failed (non-Worker env or registration error): ${String(err)}. Promise will run un-awaited.`);
  }
}
