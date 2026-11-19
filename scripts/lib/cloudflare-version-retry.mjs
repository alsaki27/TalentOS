const defaultSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Cloudflare may briefly return 404 for a Worker version immediately after a
 * deployment references it. Retry only that response; permission, network, and
 * other API failures should still fail verification immediately.
 */
export async function getWorkerVersionWithRetry({
  getVersion,
  versionId,
  deploymentId,
  attempts = 8,
  baseDelayMs = 500,
  maxDelayMs = 5_000,
  sleep = defaultSleep,
  onRetry = () => {},
}) {
  if (typeof getVersion !== "function") throw new TypeError("getVersion must be a function");
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getVersion();
    } catch (error) {
      if (error?.status !== 404) throw error;
      if (attempt === attempts) {
        throw new Error(
          `Cloudflare did not return Worker version ${versionId} for deployment ${deploymentId} after ${attempts} attempts: ${error.message}`,
          { cause: error },
        );
      }

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onRetry({ attempt, nextAttempt: attempt + 1, delayMs, versionId, deploymentId });
      await sleep(delayMs);
    }
  }

  throw new Error("Worker version retry loop exited unexpectedly");
}
