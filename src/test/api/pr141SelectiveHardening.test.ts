import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  recordAuditEvent: vi.fn(),
  refreshWorkflowRoutingSnapshot: vi.fn(),
  retryWorkflow: vi.fn(),
  transactionStatements: [] as Array<{ sql: string; values: unknown[] }>,
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
  sql: () => ({ transaction: mocks.transaction, query: mocks.query }),
  testConnection: mocks.execute,
}));
vi.mock("@/server/repositories/auditLogRepository", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/server/services/applicationAiWorkflowService", () => ({
  refreshWorkflowRoutingSnapshot: mocks.refreshWorkflowRoutingSnapshot,
  retryWorkflow: mocks.retryWorkflow,
}));

import { GET as listKeys, POST as createKey } from "@/app/api/api-keys/route";
import { DELETE as revokeKey } from "@/app/api/api-keys/[id]/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as repairQueueGet } from "@/app/api/admin/repair-ai-queue/route";
import { GET as archiveGet, POST as archivePost } from "@/app/api/admin/run-archive/route";
import { POST as createSequence, PATCH as updateSequence } from "@/app/api/email-sequences/route";
import { GET as health } from "@/app/api/health/route";
import { publicApiScopesForRole, requirePublicApiScope } from "@/lib/publicApiAuth";
import { canAccessPath } from "@/lib/auth-edge";
import { createFirstAdminProfile } from "@/server/auth/profiles";
import { sanitizeEmailPreviewStyle } from "@/components/SafeEmailPreview";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const templateId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sequenceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function userContext(role: "admin" | "manager" | "application_engineer" = "manager", id = userId) {
  return {
    context: {
      user: { id, email: `${role}@example.com` },
      profile: { user_id: id, email: `${role}@example.com`, display_name: role, role, is_active: true },
    },
    response: null,
  };
}

function jsonRequest(url: string, method: string, body: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function fakeSqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = "";
  strings.forEach((part, index) => {
    text += part;
    if (index < values.length) text += `$${index + 1}`;
  });
  mocks.transactionStatements.push({ sql: text, values });
  return { __sql: { text, values } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transactionStatements = [];
  mocks.requireCurrentUser.mockResolvedValue(userContext());
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue(null);
  mocks.execute.mockResolvedValue({ ok: true, rowCount: 1 });
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.refreshWorkflowRoutingSnapshot.mockResolvedValue(true);
  mocks.retryWorkflow.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (tag: typeof fakeSqlTag) => unknown[]) => {
    const statements = callback(fakeSqlTag);
    return statements.map((_statement, index) => index === 0 ? [{ id: sequenceId, name: "Sequence" }] : []);
  });
});

describe("PR #141 selective hardening", () => {
  it("limits non-admin key creation scopes without changing existing key authentication", async () => {
    expect(publicApiScopesForRole("admin")).toContain("jobs:delete");
    expect(publicApiScopesForRole("manager")).toContain("jobs:import");
    expect(publicApiScopesForRole("manager")).not.toContain("jobs:delete");
    expect(publicApiScopesForRole("application_engineer")).not.toContain("api_keys:manage");
    expect(canAccessPath("manager", "/settings/api-keys")).toBe(true);
    expect(canAccessPath("application_engineer", "/settings/api-keys")).toBe(true);

    mocks.queryOne.mockResolvedValue({
      id: "existing-key", name: "Existing extension integration", key_prefix: "sk_live_existing",
      scopes: ["jobs:import"], expires_at: null, revoked_at: null,
    });
    const result = await requirePublicApiScope(
      new NextRequest("https://talentos.test/api/public/jobs/import", {
        headers: { authorization: "Bearer sk_live_unchanged" },
      }),
      "jobs:import",
    );
    expect(result.response).toBeNull();
    expect(result.context?.id).toBe("existing-key");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("lists only the signed-in non-admin's keys and denies a requested destructive scope", async () => {
    mocks.query.mockResolvedValue([{ id: "owned-key", name: "Mine" }]);
    const response = await listKeys();
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain("created_by_user_id = $2");
    expect(mocks.query.mock.calls[0][1]).toEqual([false, userId]);
    const body = await response.json();
    expect(body.can_manage_all).toBe(false);
    expect(body.keys).toEqual([{ id: "owned-key", name: "Mine" }]);

    const denied = await createKey(jsonRequest("https://talentos.test/api/api-keys", "POST", {
      name: "Restricted", scopes: ["jobs:delete"],
    }));
    expect(denied.status).toBe(403);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("allows an authenticated non-admin to create a key with permitted scope and only revoke their own", async () => {
    mocks.queryOne.mockResolvedValue({ id: "new-key", name: "My crawler", scopes: ["jobs:import"] });
    const created = await createKey(jsonRequest("https://talentos.test/api/api-keys", "POST", {
      name: "My crawler", scopes: ["jobs:import", "jobs:import"],
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.key).toMatch(/^sk_live_/);
    expect(mocks.queryOne.mock.calls[0][1][3]).toEqual(["jobs:import"]);
    expect(mocks.queryOne.mock.calls[0][1][6]).toBe(userId);

    mocks.queryOne.mockResolvedValue(null);
    const denied = await revokeKey(new Request("https://talentos.test/api/api-keys/other"), { params: { id: "other" } });
    expect(denied.status).toBe(404);
    expect(mocks.queryOne.mock.calls.at(-1)?.[0]).toContain("created_by_user_id = $4");
    expect(mocks.queryOne.mock.calls.at(-1)?.[1][3]).toBe(userId);
  });

  it("keeps workspace-wide key management for admins", async () => {
    mocks.requireCurrentUser.mockResolvedValue(userContext("admin"));
    mocks.query.mockResolvedValue([]);
    const response = await listKeys();
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual([true, userId]);
    expect((await response.json()).can_manage_all).toBe(true);
  });

  it("denies unauthenticated key-list requests before reading key rows", async () => {
    mocks.requireCurrentUser.mockResolvedValue({
      context: null,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    });
    expect((await listKeys()).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("closes public staff signup without touching profile or credential storage", async () => {
    const response = await signup();
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("serializes the allowlisted first-admin creation and refuses unverified bootstrap", async () => {
    const profile = {
      user_id: userId, email: "admin@example.com", display_name: "Admin", role: "admin",
      role_variant: null, is_active: true, password_hash: null,
    };
    mocks.transaction.mockImplementation(async (callback: (tag: typeof fakeSqlTag) => unknown[]) => {
      const statements = callback(fakeSqlTag);
      expect(statements).toHaveLength(2);
      return [[], [profile]];
    });
    const created = await createFirstAdminProfile({
      email: "ADMIN@example.com", displayName: "Admin", emailVerified: true,
    });
    expect(created?.email).toBe("admin@example.com");
    expect(mocks.transactionStatements[0].sql).toContain("pg_advisory_xact_lock");
    expect(mocks.transactionStatements[1].sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM profiles)");

    mocks.transaction.mockClear();
    expect(await createFirstAdminProfile({ email: "admin@example.com", displayName: "Admin", emailVerified: false })).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects queue repair GET even when execute=1 and never invokes repair work", async () => {
    const response = await repairQueueGet(new NextRequest("https://talentos.test/api/admin/repair-ai-queue?execute=1"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(mocks.requireCurrentUser).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.retryWorkflow).not.toHaveBeenCalled();
  });

  it("retires the legacy archive endpoint without database mutations", async () => {
    expect((await archiveGet()).status).toBe(410);
    expect((await archivePost()).status).toBe(410);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("creates a sequence and steps atomically and validates step definitions", async () => {
    mocks.query.mockResolvedValue([{ id: templateId }]);
    mocks.queryOne.mockResolvedValue({ id: sequenceId, name: "Follow up" });
    const response = await createSequence(jsonRequest("https://talentos.test/api/email-sequences", "POST", {
      name: " Follow up ",
      steps: [{ step_number: 1, template_id: templateId, delay_hours: 24 }],
    }));
    expect(response.status).toBe(201);
    const call = mocks.queryOne.mock.calls[0];
    expect(call[0]).toContain("WITH new_sequence AS");
    expect(call[0]).toContain("jsonb_to_recordset");
    expect(JSON.parse(call[1][5])).toHaveLength(1);

    const invalid = await createSequence(jsonRequest("https://talentos.test/api/email-sequences", "POST", {
      name: "Bad", steps: [{ step_number: 0, template_id: templateId }],
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.queryOne).toHaveBeenCalledOnce();
  });

  it("keeps sparse sequence edits intact and lets an explicit empty steps array clear steps atomically", async () => {
    const request = (body: unknown) => jsonRequest("https://talentos.test/api/email-sequences", "PATCH", body);

    const sparse = await updateSequence(request({ id: sequenceId, is_active: false }));
    expect(sparse.status).toBe(200);
    expect(mocks.transactionStatements).toHaveLength(1);

    mocks.transactionStatements = [];
    const clear = await updateSequence(request({ id: sequenceId, steps: [] }));
    expect(clear.status).toBe(200);
    expect(mocks.transactionStatements).toHaveLength(2);
    expect(mocks.transactionStatements[1].sql).toContain("DELETE FROM email_sequence_steps");
  });

  it("returns a minimal non-cacheable public health status without diagnostics", async () => {
    mocks.execute.mockResolvedValue({ ok: true });
    const response = await health(new NextRequest("https://talentos.test/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.duration_ms).toEqual(expect.any(Number));
    expect(body).not.toHaveProperty("checks");
    expect(body).not.toHaveProperty("database");
  });

  it("allows ordinary email formatting while stripping unsafe inline CSS", () => {
    const style = sanitizeEmailPreviewStyle("color: #222; font-weight: bold; background-image: url(https://evil.test/x); position: fixed; text-align: center");
    expect(style).toContain("color: #222");
    expect(style).toContain("font-weight: bold");
    expect(style).toContain("text-align: center");
    expect(style).not.toMatch(/url|position/i);
  });
});
