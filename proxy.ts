/**
 * Protected-route proxy (DEV-1134, FR-20).
 *
 * Next.js 16 "proxy" convention (the renamed middleware). A cheap edge gate:
 * redirects unauthenticated requests for protected paths to /login (preserving
 * the intended destination). This is a presence check on the session cookie
 * only — authoritative resolution (token validity, expiry) happens at the page
 * via `requireUser`, since the auth service needs Node crypto + the repository,
 * which don't run in the edge matcher path.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/** Path prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = ["/dashboard"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) {
    return NextResponse.next();
  }
  const hasSession =
    request.cookies.get(SESSION_COOKIE_NAME)?.value !== undefined;
  if (hasSession) {
    return NextResponse.next();
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
