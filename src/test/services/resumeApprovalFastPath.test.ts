import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { getStudioApprovalPdf } from "@/server/services/studioResumePdf";
import { canonicalContent } from "@/lib/ai/application-agents/resumeReleasePdf";
import { sha256Hex } from "@/lib/sha256";

const browser = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@cloudflare/puppeteer", () => ({ default: browser }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: {} }) }));

describe("resume approval fast paths", () => {
  const fetchGraph = vi.fn();
  beforeEach(() => {
    vi.stubEnv("TALENTOS_BASE_URL", "https://talent.example");
    vi.stubEnv("MS_TENANT_ID", "tenant");
    vi.stubEnv("MS_CLIENT_ID", "client");
    vi.stubEnv("MS_CLIENT_SECRET", "test-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site");
    vi.stubEnv("SHAREPOINT_DRIVE_FOLDER", "resumes");
    fetchGraph.mockReset();
    vi.stubGlobal("fetch", fetchGraph);
    browser.launch.mockReset().mockRejectedValue(new Error("Unexpected browser render"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uploads to an existing archive folder with one Graph request", async () => {
    fetchGraph.mockResolvedValueOnce(Response.json({ access_token: "token", expires_in: 300 }));
    fetchGraph.mockResolvedValueOnce(Response.json({ id: "file", webUrl: "https://test/file" }));
    await expect(uploadToSharePoint("candidate/job/resume.pdf", new Uint8Array([1]), "application/pdf", {
      preferExistingFolder: true,
    })).resolves.toMatchObject({ itemId: "file" });
    expect(fetchGraph.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "PUT"]);
  });

  it("creates missing parents and retries once while retaining the same PDF bytes", async () => {
    fetchGraph.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "token", expires_in: 300 });
      if (init.method === "POST") return new Response(null, { status: 409 });
      const puts = fetchGraph.mock.calls.filter(([uri, request]) => uri.includes("graph.microsoft.com") && request.method === "PUT");
      return puts.length === 1 ? new Response(null, { status: 404 }) : Response.json({ id: "file", webUrl: "https://test/file" });
    });
    const bytes = new Uint8Array([12, 34]);
    await expect(uploadToSharePoint("candidate/job/resume.pdf", bytes, "application/pdf", {
      preferExistingFolder: true,
    })).resolves.toMatchObject({ itemId: "file" });
    const graphCalls = fetchGraph.mock.calls.filter(([url]) => url.includes("graph.microsoft.com"));
    expect(graphCalls.map(([, init]) => init.method)).toEqual(["PUT", "POST", "POST", "POST", "PUT"]);
    for (const [, init] of graphCalls.filter(([, request]) => request.method === "PUT")) {
      expect(new Uint8Array(await init.body.arrayBuffer())).toEqual(bytes);
    }
  });

  it("uses a validated prepared PDF only for the exact saved content and theme", async () => {
    const content = { header: { fullName: "Fixture Candidate" }, template: "business-professional" };
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256Hex(canonicalContent(content));
    const match = vi.fn(async (key: Request) => {
      if (!key.url.endsWith("/resume-version/" + hash)) return undefined;
      return new Response(bytes, { headers: {
        "x-studio-pdf-sha": await sha256Hex(bytes),
        "x-studio-pdf-metrics": JSON.stringify({ pageCount: 2, identityVerified: true, horizontalOverflow: false, template: content.template }),
      } });
    });
    vi.stubGlobal("caches", { open: vi.fn(async () => ({ match })) });
    const prepared = await getStudioApprovalPdf("resume-version", content);
    expect(prepared).toMatchObject({ prepared: true, contentHash: hash, metrics: { pageCount: 2, template: content.template } });
    await expect(getStudioApprovalPdf("resume-version", { ...content, template: "modern-minimal" }))
      .rejects.toThrow(); // Cache miss follows the live render path (no Worker browser in this fixture).
    expect(match.mock.calls[1][0].url).not.toBe(match.mock.calls[0][0].url);
  });

  it("prepares a Studio PDF once and skips the browser during approval when the cache entry matches", async () => {
    const bytes = Buffer.from("%PDF-1.4\n<< /Type /Pages /Count 1 >>\n");
    const evaluate = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      pageCount: 1, identityVerified: true, horizontalOverflow: false,
    });
    browser.launch.mockResolvedValueOnce({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({
        setDefaultTimeout: vi.fn(), setViewport: vi.fn(), setRequestInterception: vi.fn(), on: vi.fn(),
        goto: vi.fn().mockResolvedValue({ ok: () => true }), url: () => "https://talent.example/resume-print",
        waitForFunction: vi.fn(), evaluate, pdf: vi.fn().mockResolvedValue(bytes),
      }),
    });
    const entries = new Map<string, Response>();
    vi.stubGlobal("caches", { open: async () => ({
      put: async (key: Request, value: Response) => { entries.set(key.url, value); },
      match: async (key: Request) => entries.get(key.url)?.clone(),
    }) });
    const draft = { header: { fullName: "Fixture Candidate" }, template: "modern-minimal" };
    await getStudioApprovalPdf("version", draft, true);
    expect(evaluate.mock.calls[0][1]).toMatchObject({ template: "modern-minimal" });
    await expect(getStudioApprovalPdf("version", draft)).resolves.toMatchObject({
      prepared: true, metrics: { template: "modern-minimal", pageCount: 1 },
    });
    expect(browser.launch).toHaveBeenCalledTimes(1);
  });
});
