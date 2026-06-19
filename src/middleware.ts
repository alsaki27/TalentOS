import { NextRequest, NextResponse } from "next/server";

const ACCESS_TOKEN_COOKIE = "skarion_access_token";

const PUBLIC_FILE = /\.(.*)$/;

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/api/portal") ||
    pathname.startsWith("/api/public") ||
    pathname === "/api/integrations/gmail/callback" ||
    pathname === "/api/integrations/talent-os/webhook" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  );
}

async function getVerifiedSession(token: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=user_id,role,is_active&user_id=eq.${user.id}&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: "no-store",
    },
  );

  if (!profileRes.ok) return null;
  const profiles = await profileRes.json();
  const profile = profiles?.[0];
  if (!profile?.is_active) return null;

  return { userId: user.id as string, role: profile.role as string };
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
  if (isPublicPath(pathname)) return NextResponse.next();
  if (isCronAuthorized(req, pathname)) return NextResponse.next();
  if (isCrawlerAuthorized(req, pathname)) return NextResponse.next();

  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const session = token ? await getVerifiedSession(token) : null;
  if (session) {
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
