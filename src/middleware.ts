import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/server/auth/jwt";
import { queryOne } from "@/server/db/neon";
import { canAccessPath, getDefaultRouteForRole, normalizeUserRole } from "@/lib/auth";

const ACCESS_TOKEN_COOKIE = "skarion_access_token";
const CANDIDATE_TOKEN_COOKIE = "skarion_candidate_token";

const PUBLIC_FILE = /\.(.*)$/;

// The pre-existing anonymous magic-link routes (/api/portal/<portal_token>/...)
// stay public unchanged — the token itself is the secret, same as before this
// feature existed. Only the new /api/portal/me/* and /api/portal/auth/* paths are
// real, session-gated endpoints; distinguish by the literal second path segment.
function isLegacyAnonymousPortalPath(pathname: string) {
  const match = pathname.match(/^\/api\/portal\/([^/]+)(?:\/|$)/);
  if (!match) return false;
  return match[1] !== "me" && match[1] !== "auth";
}

function isPortalAuthPublicPath(pathname: string) {
  return (
    pathname === "/portal/login" ||
    pathname.startsWith("/portal/invite/") ||
    pathname.startsWith("/api/portal/auth/") ||
    pathname.startsWith("/api/portal/invite/")
  );
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/privacy" ||
    isPortalAuthPublicPath(pathname) ||
    isLegacyAnonymousPortalPath(pathname) ||
    pathname.startsWith("/api/public") ||
    pathname === "/api/health" ||
    pathname === "/api/skarion-ai" ||
    pathname === "/api/integrations/gmail/callback" ||
    pathname === "/api/integrations/talent-os/webhook" ||
    pathname === "/api/webhooks/gmail" ||
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

// The external MCP connector authenticates with its own mcp_live_* bearer key
// inside the route handler. Do not require a browser session before that
// handler can validate the machine credential.
function isMcpApiPath(pathname: string) {
  return pathname === "/api/mcp";
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

// Candidate-session-gated paths: everything under /portal (except the public
// login/invite pages already excluded above) and /api/portal/me/*. Entirely
// separate cookie/JWT from staff — never touches ACCESS_TOKEN_COOKIE or the
// profiles table, so staff auth and the job-application routes are unaffected.
function isCandidatePortalPath(pathname: string) {
  if (pathname.startsWith("/api/portal/me")) return true;
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

async function getVerifiedCandidateSession(token: string) {
  const jwtPayload = await verifyJWT(token);
  if (!jwtPayload || jwtPayload.type !== "candidate") return null;
  const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id = $1", [jwtPayload.user_id]);
  return candidate ? { candidateId: candidate.id } : null;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (isCandidatePortalPath(pathname)) {
    const candidateToken = req.cookies.get(CANDIDATE_TOKEN_COOKIE)?.value;
    const candidateSession = candidateToken ? await getVerifiedCandidateSession(candidateToken) : null;
    if (candidateSession) {
      const res = NextResponse.next();
      res.headers.set("x-skarion-candidate-id", candidateSession.candidateId);
      return res;
    }
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const portalLoginUrl = req.nextUrl.clone();
    portalLoginUrl.pathname = "/portal/login";
    portalLoginUrl.search = "";
    portalLoginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(portalLoginUrl);
  }
  // Extension API paths: skip middleware auth entirely — each route handler
  // authenticates via its own authenticateExtension() call and handles CORS
  // via withExtensionCors(). Intercepting here drops CORS headers on Cloudflare Workers.
  if (isExtensionApiPath(pathname)) return NextResponse.next();
  if (isMcpApiPath(pathname)) return NextResponse.next();
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
