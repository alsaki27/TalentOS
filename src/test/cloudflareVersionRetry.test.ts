import { describe, expect, test, vi } from "vitest";
import { getWorkerVersionWithRetry } from "../../scripts/lib/cloudflare-version-retry.mjs";

function cloudflareError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

describe("Cloudflare Worker version visibility retries", () => {
  test("retries a transient 404 and returns the version details", async () => {
    const version = { id: "version-123", resources: { bindings: [] } };
    const getVersion = vi.fn()
      .mockRejectedValueOnce(cloudflareError(404, "version not found"))
      .mockRejectedValueOnce(cloudflareError(404, "version not found"))
      .mockResolvedValueOnce(version);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(getWorkerVersionWithRetry({
      getVersion,
      versionId: version.id,
      deploymentId: "deployment-456",
      sleep,
    })).resolves.toBe(version);

    expect(getVersion).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1_000]]);
  });

  test("fails clearly after the bounded retry window for a persistent 404", async () => {
    const notFound = cloudflareError(404, "version not found");
    const getVersion = vi.fn().mockRejectedValue(notFound);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(getWorkerVersionWithRetry({
      getVersion,
      versionId: "missing-version",
      deploymentId: "deployment-456",
      attempts: 3,
      sleep,
    })).rejects.toMatchObject({
      message: expect.stringContaining("missing-version for deployment deployment-456 after 3 attempts"),
      cause: notFound,
    });

    expect(getVersion).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("does not retry non-404 errors", async () => {
    const forbidden = cloudflareError(403, "permission denied");
    const getVersion = vi.fn().mockRejectedValue(forbidden);
    const sleep = vi.fn();

    await expect(getWorkerVersionWithRetry({
      getVersion,
      versionId: "version-123",
      deploymentId: "deployment-456",
      sleep,
    })).rejects.toBe(forbidden);

    expect(getVersion).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
