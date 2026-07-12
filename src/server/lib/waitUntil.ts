// Registers a background promise with the Cloudflare Workers execution
// context so it survives past the HTTP response being sent. Without this,
// every "fire-and-forget" dispatch call in the AI workflow pipeline
// (dispatchWorkflowById) is only guaranteed to run for as long as the
// Worker happens to stay alive after responding - which on Cloudflare
// Workers can be cut short at any point, silently dropping the next
// pipeline stage and leaving a workflow stuck until the 5-minute cron
// dispatcher (or a manual retry) picks it back up. Confirmed live: stage
// transitions repeatedly stalled mid-pipeline during testing.
//
// Falls back to just letting the promise run un-awaited (today's behavior)
// when not running inside a real Cloudflare Workers request - e.g. local
// dev via `next dev`, or any environment where getCloudflareContext() isn't
// available. Never throws: a failure to register with waitUntil should
// never break the caller's actual response.
export function backgroundDispatch(promise: Promise<unknown>): void {
  const suppressed = promise.catch(() => {});
  import("@opennextjs/cloudflare")
    .then(({ getCloudflareContext }) => getCloudflareContext())
    .then(({ ctx }) => ctx.waitUntil(suppressed))
    .catch(() => {
      // Not in a Cloudflare Workers context, or waitUntil registration
      // itself failed - the original promise is still running above,
      // just without the extended-lifetime guarantee.
    });
}
