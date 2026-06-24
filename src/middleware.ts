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

function createRequestHeaders(req: NextRequest, pathname: string, search: string, publicRoute: boolean) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-skarion-pathname", pathname);
  requestHeaders.set("x-skarion-search", search);
  requestHeaders.set("x-skarion-public-route", publicRoute ? "true" : "false");
  return requestHeaders;
}

function nextWithRequestHeaders(req: NextRequest, pathname: string, search: string, publicRoute: boolean) {
  return NextResponse.next({
    request: {
      headers: createRequestHeaders(req, pathname, search, publicRoute),
    },
  });
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

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const publicRoute = isPublicPath(pathname);
  if (publicRoute) return nextWithRequestHeaders(req, pathname, search, true);
  if (isCronAuthorized(req, pathname)) return NextResponse.next();
  if (isCrawlerAuthorized(req, pathname)) return NextResponse.next();

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

    const res = nextWithRequestHeaders(req, pathname, search, false);
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
