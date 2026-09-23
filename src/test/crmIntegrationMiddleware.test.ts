import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

const integrationSecret = "crm-integration-test-secret";
const previousSecret = process.env.CRM_INTEGRATION_SECRET;

function makeRequest(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://talentos.test${pathname}`, { headers });
}

describe("CRM integration middleware access", () => {
  beforeEach(() => {
    process.env.CRM_INTEGRATION_SECRET = integrationSecret;
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.CRM_INTEGRATION_SECRET;
    else process.env.CRM_INTEGRATION_SECRET = previousSecret;
  });

  it("allows a valid bearer secret to reach the candidate route", async () => {
    const response = await middleware(
      makeRequest("/api/integrations/crm/candidates", {
        authorization: `Bearer ${integrationSecret}`,
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the supported integration-secret header", async () => {
    const response = await middleware(
      makeRequest("/api/integrations/crm/candidate-outreach", {
        "x-crm-integration-secret": integrationSecret,
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not bypass the session gate for a wrong secret or unrelated path", async () => {
    const wrongSecretResponse = await middleware(
      makeRequest("/api/integrations/crm/candidates", {
        authorization: "Bearer wrong-secret",
      }),
    );
    const unrelatedPathResponse = await middleware(
      makeRequest("/api/integrations/crm/other", {
        authorization: `Bearer ${integrationSecret}`,
      }),
    );

    expect(wrongSecretResponse.status).toBe(401);
    expect(unrelatedPathResponse.status).toBe(401);
  });
});
