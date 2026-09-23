// The single database access layer for TalentOS.
//
// The file is still named `neon.ts` because 361 modules import it as
// "@/server/db/neon"; renaming it would churn every one of them for no
// functional gain. It is no longer Neon-specific - it picks a driver from the
// connection string, so moving between Neon and the self-hosted Postgres on the
// VPS is a configuration change (one secret) rather than a code change, and
// rolling back is the same.
//
//   *.neon.tech  -> @neondatabase/serverless over HTTP (no TCP, works anywhere)
//   anything else -> node-postgres over TCP
//
// ── Why the pg path is shaped the way it is ────────────────────────────────
//
// On Cloudflare Workers a socket opened while serving one request may not be
// touched while serving another; a long-lived pg.Pool caches idle sockets across
// requests and therefore fails with "Cannot perform I/O on behalf of a different
// request". So on Workers each unit of work gets its own Client, which is cheap
// because Hyperdrive already pools connections to the origin. Under Node
// (scripts, tests, local dev) a real Pool is used, since that is strictly better
// there.
//
// ── Cloudflare Hyperdrive ──────────────────────────────────────────────────
//
// Workers cannot verify the VPS's self-signed certificate - pg-cloudflare calls
// startTls({ secureTransport: "starttls" }) and Cloudflare's socket API exposes
// no way to supply a CA or skip verification. Hyperdrive solves that by
// connecting from Cloudflare's network, and worker-entry.mjs copies its binding's
// connection string into process.env.DATABASE_URL so this module stays runtime
// agnostic. Hyperdrive terminates locally, so that URL needs no TLS of its own.

import type { Pool as PgPool, PoolClient, QueryResult } from "pg";

type Row = Record<string, any>;

/** A lazily-executed query. Awaiting it runs it; a transaction runs it inline. */
interface LazyQuery<T = Row[]> extends PromiseLike<T> {
  readonly __sql: { text: string; params: unknown[]; fullResults: boolean };
}

interface SqlClient {
  <T = Row[]>(strings: TemplateStringsArray, ...values: unknown[]): LazyQuery<T>;
  query<T = Row[]>(text: string, params?: unknown[], opts?: { fullResults?: boolean }): LazyQuery<T>;
  transaction<T = Row[]>(
    input: LazyQuery<any>[] | ((tx: SqlClient) => LazyQuery<any>[] | void)
  ): Promise<T[]>;
}

const isNeon = (url: string) => /\.neon\.tech(?::|\/|$)/i.test(url);

// Workers set navigator.userAgent to this; it is the documented way to detect the
// runtime without bundling a Node-only check.
const onWorkers =
  typeof navigator !== "undefined" && (navigator as any)?.userAgent === "Cloudflare-Workers";

function getWorkerHyperdriveUrl(): string | undefined {
  const value = (globalThis as { __TALENTOS_HYPERDRIVE_CONNECTION_STRING?: unknown })
    .__TALENTOS_HYPERDRIVE_CONNECTION_STRING;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getDatabaseUrl(): string {
  // OpenNext can initialize the bundled server before the Worker fetch handler
  // runs. Keep the request-time Hyperdrive binding in an isolate-local global
  // as well as process.env so the database layer cannot fall back to the direct
  // self-hosted Postgres URL when process.env is not writable/populated yet.
  const raw = getWorkerHyperdriveUrl() ?? process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!raw) {
    console.error("[DB] FATAL: Missing DATABASE_URL");
    throw new Error(
      "DATABASE_URL or NEON_DATABASE_URL is not configured. Set it in your environment or Cloudflare secrets."
    );
  }
  return raw;
}

/**
 * TLS settings for a direct (non-Hyperdrive) Postgres connection.
 *
 * The VPS presents a self-signed certificate. Modern pg-connection-string treats
 * `sslmode=require` as `verify-full`, which rejects it outright, so the mode is
 * stripped from the URL and TLS is configured explicitly instead: still
 * encrypted (verified as TLSv1.3 against the server), just not CA-verified.
 * Until a CA-issued certificate is installed, that is the strongest setting the
 * server actually supports - and it is a large improvement on the alternative of
 * disabling TLS, which would put the password on the wire in clear text.
 */
function pgConnectionConfig(rawUrl: string) {
  const url = new URL(rawUrl);
  const sslmode = url.searchParams.get("sslmode");
  // channel_binding is Neon-specific and rejected by plain Postgres.
  url.searchParams.delete("channel_binding");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");

  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  // Hyperdrive terminates locally and handles origin TLS itself; `disable` is an
  // explicit opt-out for anyone running Postgres on the same host.
  const noTls = local || sslmode === "disable";

  return {
    connectionString: url.toString(),
    ssl: noTls ? false : ({ rejectUnauthorized: false } as const),
  };
}

// ── pg driver ───────────────────────────────────────────────────────────────

let _pool: PgPool | null = null;
let _poolUrl: string | null = null;

async function getPool(): Promise<PgPool> {
  const rawUrl = getDatabaseUrl();
  if (!_pool || _poolUrl !== rawUrl) {
    const { default: pg } = await import("pg");
    const previousPool = _pool;
    const cfg = pgConnectionConfig(rawUrl);
    console.log(`[DB] Initializing Postgres pool (host: ${new URL(cfg.connectionString).hostname})`);
    _pool = new pg.Pool({ ...cfg, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    _poolUrl = rawUrl;
    // A Worker isolate can initialize the application bundle before the
    // request-time Hyperdrive binding is available. If that first query built
    // a pool from the fallback DATABASE_URL, do not keep reusing it after the
    // binding arrives. Drain the old pool in the background so in-flight work
    // can finish without leaking sockets.
    if (previousPool && previousPool !== _pool) {
      void previousPool.end().catch((err) =>
        console.warn("[DB] Previous Postgres pool close failed after URL switch:", err?.message ?? err)
      );
    }
    // An idle-client error must never become an unhandled rejection that takes
    // the process down; the pool discards the client and the next query redials.
    _pool.on("error", (err) => console.error("[DB] Idle client error:", err.message));
  }
  return _pool;
}

let warnedNoHyperdrive = false;

/**
 * Warns once per isolate if a Worker is dialling a remote Postgres directly.
 *
 * Two things go wrong in that case and both are confusing to diagnose from the
 * symptom alone: TLS fails outright against a self-signed certificate, and even
 * with a valid one every unit of work pays a full handshake (measured at ~4s to
 * this server). Hyperdrive fixes both. See the [[hyperdrive]] block in
 * wrangler.toml for the one-time setup.
 */
function warnIfWorkerWithoutHyperdrive(url: string) {
  if (warnedNoHyperdrive) return;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return; // Hyperdrive, as expected
  warnedNoHyperdrive = true;
  console.error(
    `[DB] Running on Workers but DATABASE_URL points directly at ${host}. ` +
      "Expected the Hyperdrive binding. TLS will fail against a self-signed certificate, " +
      "and each query pays a fresh connection handshake. Create the Hyperdrive config and " +
      "uncomment the [[hyperdrive]] binding in wrangler.toml."
  );
}

/** Runs `fn` against a connection, choosing pooling appropriate to the runtime. */
async function withPgClient<T>(fn: (c: PoolClient | any) => Promise<T>): Promise<T> {
  if (onWorkers) {
    const { default: pg } = await import("pg");
    const rawUrl = getDatabaseUrl();
    warnIfWorkerWithoutHyperdrive(rawUrl);
    const client = new pg.Client(pgConnectionConfig(rawUrl));
    await client.connect();
    try {
      return await fn(client);
    } finally {
      // Never let a close failure mask the real error from fn().
      await client.end().catch(() => {});
    }
  }
  const pool = await getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function buildTemplate(strings: TemplateStringsArray, values: unknown[]) {
  let text = "";
  strings.forEach((part, i) => {
    text += part;
    if (i < values.length) text += `$${i + 1}`;
  });
  return { text, params: values };
}

/**
 * Wraps a statement as a lazy, awaitable descriptor. Awaiting runs it on its own
 * connection; handing it to transaction() runs it on the shared one instead.
 * This is what lets the existing `sql.transaction([ sql`...`, sql`...` ])` call
 * sites keep working unchanged.
 */
function lazy<T>(text: string, params: unknown[], fullResults: boolean): LazyQuery<T> {
  const run = () => withPgClient(async (c) => shape<T>(await c.query(text, params), fullResults));
  return {
    __sql: { text, params, fullResults },
    then: (onOk: any, onErr: any) => run().then(onOk, onErr),
  } as LazyQuery<T>;
}

function shape<T>(res: QueryResult<any>, fullResults: boolean): T {
  return (fullResults ? res : res.rows) as T;
}

function makePgSql(): SqlClient {
  const sqlFn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = buildTemplate(strings, values);
    return lazy(text, params, false);
  };

  sqlFn.query = (text: string, params: unknown[] = [], opts?: { fullResults?: boolean }) =>
    lazy(text, params, !!opts?.fullResults);

  // A real BEGIN/COMMIT on one connection. Both existing shapes are supported:
  // an array of descriptors, or a callback handed a `tx` that records them.
  sqlFn.transaction = async (input: any) => {
    const descriptors: LazyQuery<any>[] = [];
    const collected: LazyQuery<any>[] =
      typeof input === "function"
        ? ((input(collectingSql(descriptors)) as LazyQuery<any>[] | void) ?? descriptors)
        : input;

    return withPgClient(async (client) => {
      await client.query("BEGIN");
      try {
        const out: any[] = [];
        for (const d of collected) {
          const q = d.__sql;
          out.push(shape(await client.query(q.text, q.params), q.fullResults));
        }
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
  };

  return sqlFn as SqlClient;
}

/** A `tx` handle whose queries are recorded as descriptors instead of executed. */
function collectingSql(sink: LazyQuery<any>[]): SqlClient {
  const mk = (text: string, params: unknown[], fullResults: boolean) => {
    const d = {
      __sql: { text, params, fullResults },
      then: () => {
        throw new Error("[DB] A transaction query cannot be awaited on its own; return it from the callback.");
      },
    } as unknown as LazyQuery<any>;
    sink.push(d);
    return d;
  };
  const fn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = buildTemplate(strings, values);
    return mk(text, params, false);
  };
  fn.query = (text: string, params: unknown[] = [], opts?: { fullResults?: boolean }) =>
    mk(text, params, !!opts?.fullResults);
  fn.transaction = () => {
    throw new Error("[DB] Nested transactions are not supported.");
  };
  return fn as SqlClient;
}

// ── Neon driver (retained so the connection string alone decides) ───────────

let _neonSql: any = null;
let _neonUrl: string | null = null;

async function getNeonSql() {
  const rawUrl = getDatabaseUrl();
  if (!_neonSql || _neonUrl !== rawUrl) {
    const { neon } = await import("@neondatabase/serverless");
    const url = new URL(rawUrl);
    url.searchParams.delete("channel_binding"); // TCP-only, rejected over HTTP
    console.log(`[DB] Initializing Neon HTTP connection (host: ${url.hostname})`);
    _neonSql = neon(url.toString(), { fetchOptions: { cache: "no-store" } });
    _neonUrl = rawUrl;
  }
  return _neonSql;
}

// ── public API (unchanged signatures - 361 modules depend on these) ────────

let _client: SqlClient | null = null;
let _clientUrl: string | null = null;

function getClient(): SqlClient {
  const url = getDatabaseUrl();
  // The Worker binding is only available inside fetch(request, env, ctx). A
  // module imported earlier can therefore initialize this adapter against the
  // fallback DATABASE_URL. Cache by URL, not just by module lifetime, so the
  // first real request switches to Hyperdrive instead of silently continuing
  // to use the direct VPS connection for the entire isolate lifetime.
  if (_client && _clientUrl === url) return _client;

  if (isNeon(url)) {
    // Defer to the Neon driver, adapting its (already lazy) results to the same
    // shape so callers cannot tell which driver is underneath.
    const fn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const p = getNeonSql().then((s: any) => s(strings, ...values));
      return { __sql: buildTemplateMeta(strings, values), then: (a: any, b: any) => p.then(a, b) };
    };
    fn.query = (text: string, params: unknown[] = [], opts?: { fullResults?: boolean }) => {
      const p = getNeonSql().then((s: any) => s.query(text, params, opts));
      return { __sql: { text, params, fullResults: !!opts?.fullResults }, then: (a: any, b: any) => p.then(a, b) };
    };
    fn.transaction = async (input: any) => {
      const s = await getNeonSql();
      return s.transaction(typeof input === "function" ? input(s) : input);
    };
    _client = fn as SqlClient;
  } else {
    _client = makePgSql();
  }
  _clientUrl = url;
  return _client;
}

function buildTemplateMeta(strings: TemplateStringsArray, values: unknown[]) {
  const { text, params } = buildTemplate(strings, values);
  return { text, params, fullResults: false };
}

/**
 * The raw client, for the few call sites that need tagged templates or
 * transactions (see finalizationService.ts and the AI routing admin routes).
 */
export function sql(): SqlClient {
  return getClient();
}

export async function query<T = any>(queryText: string, params?: unknown[]): Promise<T[]> {
  try {
    return (await getClient().query<T[]>(queryText, params ?? [])) as T[];
  } catch (e: any) {
    console.error("[DB] Query failed:", queryText.slice(0, 200));
    console.error("[DB] Error:", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function queryOne<T = any>(queryText: string, params?: unknown[]): Promise<T | null> {
  const results = await query<T>(queryText, params);
  return results.length > 0 ? results[0] : null;
}

export async function execute(queryText: string, params?: unknown[]): Promise<{ rowCount: number }> {
  try {
    const result: any = await getClient().query(queryText, params ?? [], { fullResults: true });
    const rc = result && typeof result === "object" && "rowCount" in result ? result.rowCount : 0;
    return { rowCount: typeof rc === "number" ? rc : 0 };
  } catch (e: any) {
    console.error("[DB] Execute failed:", queryText.slice(0, 200));
    throw e;
  }
}

export async function testConnection(): Promise<{
  ok: boolean;
  timestamp: string;
  version?: string;
  driver?: string;
  error?: string;
}> {
  const driver = (() => {
    try {
      return isNeon(getDatabaseUrl()) ? "neon-http" : "postgres-tcp";
    } catch {
      return "unconfigured";
    }
  })();
  try {
    const rows: any = await getClient().query("SELECT NOW() as time, version() as version");
    return { ok: true, driver, timestamp: rows[0]?.time ?? "unknown", version: rows[0]?.version ?? "unknown" };
  } catch (e: any) {
    return { ok: false, driver, timestamp: "", error: e instanceof Error ? e.message : String(e) };
  }
}
