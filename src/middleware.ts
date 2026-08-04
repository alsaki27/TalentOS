import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/server/auth/jwt";
import { queryOne } from "@/server/db/neon";
import { canAccessPath, getDefaultRouteForRole, normalizeUserRole } from "@/lib/auth";

const ACCESS_TOKEN_COOKIE = "skarion_access_token";

const PUBLIC_FILE = /\.(.*)$/;

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/api/portal") ||
    pathname.startsWith("/api/public") ||
    pathname === "/api/health" ||
    pathname === "/api/integrations/gmail/callback" ||
    pathname === "/api/integrations/talent-os/webhook" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  );
}

async function getVerifiedSession(token: string) {
  const jwtPayload = await verifyJWT(token);
  if (!jwtPayload) return null;

  const profile = await queryOne<{ user_id: string; role: string; is_active: boolean }>(
    "SELECT user_id, role, is_active FROM profiles WHERE user_id = $1",
    [jwtPayload.user_id]
  );

  if (!profile || !profile.is_active) return null;
  return { userId: jwtPayload.user_id, role: normalizeUserRole(profile.role) };
}

// Vercel Cron invokes this without a session cookie — gated by a bearer secret
// instead. The route itself re-checks the same secret (defense in depth).
function isCronAuthorized(req: NextRequest, pathname: string) {
  if (!pathname.startsWith("/api/cron")) return false;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// The A4 Extension API (/api/extension/v1/*) is called by an external browser
// extension / MCP server with no session cookie — it authenticates via a bearer
// "tos_..." token hashed (SHA-256) against extension_api_keys, done inside each
// route handler by authenticateExtension(). Let these paths reach the handler so
// that auth gate can run instead of middleware's generic session-cookie check
// short-circuiting them with a 401 before they ever get there. Admin key
// management (/api/admin/extension-keys) is deliberately NOT bypassed — that stays
// staff-session-gated.
function isExtensionApiPath(pathname: string) {
  return pathname.startsWith("/api/extension/v1/");
}

function getExtensionCorsResponse(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin") || "*";
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-TalentOS-Client",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }
  const res = NextResponse.next();
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-TalentOS-Client");
  res.headers.set("Access-Control-Allow-Credentials", "true");
  return res;
}

// An external job-crawler bot has no session cookie either — same bearer-secret
// pattern as cron, scoped to only the two endpoints it actually calls (not /status or
// /stream, which stay behind normal staff auth). Route itself re-checks the key too.
// Also accepts CRON_SECRET so cron jobs can trigger crawler ingestion if desired.
function isCrawlerAuthorized(req: NextRequest, pathname: string) {
  if (pathname !== "/api/integrations/crawler/jobs" && pathname !== "/api/integrations/crawler/heartbeat") return false;
  const authHeader = req.headers.get("authorization");
  const crawlerKey = process.env.CRAWLER_API_KEY;
  if (crawlerKey && authHeader === `Bearer ${crawlerKey}`) return true;
  // Fallback: allow cron secret to invoke crawler endpoints for scheduled crawls
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

// The nightly OpenJobData GitHub Actions workflow, and the generic job-sources
// dispatcher (src/app/api/job-agent/sources/dispatch/route.ts) that fans out to
// TheirStack/LinkUp/etc., both have no session cookie either — same bearer-secret
// (CRON_SECRET) pattern as /api/cron/*, scoped to just these two endpoints. Each
// route re-checks the secret too (defense in depth).
const OPEN_JOB_DATA_STYLE_PATHS = new Set([
  "/api/job-agent/openjobdata-ingest",
  "/api/job-agent/sources/dispatch",
  "/api/admin/retry-failed-since",
  // match-score's own handler has no auth check of its own (relies entirely
  // on this middleware gate) - only bypass its normal session requirement
  // for the CRON_SECRET-bearing server-to-server call retry-failed-since
  // makes; anonymous requests still fall through to the session check below.
  "/api/jobs/match-score",
]);
function isOpenJobDataIngestAuthorized(req: NextRequest, pathname: string) {
  if (!OPEN_JOB_DATA_STYLE_PATHS.has(pathname)) return false;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isJobCeoAuthorized(req: NextRequest, pathname: string) {
  if (pathname === "/api/job-ceo/dispatch" || pathname === "/api/job-ceo/enrich") {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  if (pathname === "/api/job-ceo/ingest") {
    const secret = process.env.JOB_CEO_INGEST_SECRET;
    if (!secret) return false;
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  return false;
}

// The AI key readiness endpoint is hit by GitHub Actions deployment CI — it has no
// session cookie but authenticates via CRON_SECRET Bearer in the route handler.
// Middleware must let it through so the route can apply its own auth logic.
function isAiKeyReadinessAuthorized(req: NextRequest, pathname: string) {
  if (pathname !== "/api/admin/ai-key-readiness") return false;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  // Extension API paths: skip middleware auth entirely — each route handler
  // authenticates via its own authenticateExtension() call and handles CORS
  // via withExtensionCors(). Intercepting here drops CORS headers on Cloudflare Workers.
  if (isExtensionApiPath(pathname)) return NextResponse.next();
  if (isCronAuthorized(req, pathname)) return NextResponse.next();
  if (isCrawlerAuthorized(req, pathname)) return NextResponse.next();
  if (isOpenJobDataIngestAuthorized(req, pathname)) return NextResponse.next();
  if (isJobCeoAuthorized(req, pathname)) return NextResponse.next();
  if (isAiKeyReadinessAuthorized(req, pathname)) return NextResponse.next();

  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const session = token ? await getVerifiedSession(token) : null;
  if (session) {
    if (!canAccessPath(session.role, pathname)) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }

      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = getDefaultRouteForRole(session.role);
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    const res = NextResponse.next();
    res.headers.set("x-skarion-user-id", session.userId);
    res.headers.set("x-skarion-role", session.role);
    return res;
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
