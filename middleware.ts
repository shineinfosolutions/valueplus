import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { panelForSlug, panelPathForRole } from "@/lib/role-routes";

// API routes anyone may call without a session:
// - /api/auth/* is NextAuth itself (csrf, signin, callback, session …). withAuth
//   never hands these to the function below, so the other routes under it
//   (permissions, security-pin, seed) must check the session themselves.
// - /api/track/* backs the public order-tracking page app/track/[id].
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/track/"];

function apiGate(pathname: string, token: any) {
  const path = pathname.replace(/\/+$/, "");

  if (PUBLIC_API_PREFIXES.some((p) => `${path}/`.startsWith(p))) {
    return null;
  }

  // Every other route handler expects a signed-in user; many do not check
  // for themselves, so the check lives here.
  if (!token) return apiError(401, "You must be signed in to do this.");
  return null;
}

function apiError(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isAuth = !!token;
    const pathname = req.nextUrl.pathname;

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return apiGate(pathname, token);
    }

    const isAuthPage = pathname.startsWith("/login");
    const role = (token as any)?.role as string | undefined;

    if (isAuthPage) {
      if (isAuth) {
        return NextResponse.redirect(new URL(panelPathForRole(role), req.url));
      }
      return null;
    }

    // The site root (and so the installed app's start screen) opens the signed-in
    // user's own panel, or the common login for everyone else.
    if (pathname === "/") {
      return NextResponse.redirect(new URL(isAuth ? panelPathForRole(role) : "/login", req.url));
    }

    // A role's panel URL: /admin, /salesman, /driver …
    const panel = panelForSlug(pathname);
    if (panel) {
      if (!isAuth) {
        return NextResponse.redirect(new URL(`/login?panel=${panel.slug}`, req.url));
      }
      // /warehouse is a real page that other roles (admin) also use from the menu,
      // so it is simply served; only the alias panels below are role-bound.
      if (panel.home === pathname) {
        return null;
      }
      const ownPanelPath = panelPathForRole(role);
      // Someone else's panel — send them to their own instead.
      if (ownPanelPath !== `/${panel.slug}`) {
        return NextResponse.redirect(new URL(ownPanelPath, req.url));
      }
      // Show the panel's page while the address stays on the panel URL.
      return NextResponse.rewrite(new URL(panel.home, req.url));
    }

    if (!isAuth) {
      let from = pathname;
      if (req.nextUrl.search) {
        from += req.nextUrl.search;
      }
      return NextResponse.redirect(
        new URL(`/login?from=${encodeURIComponent(from)}`, req.url)
      );
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => true, // We handle redirects in the middleware function
    },
    secret: process.env.NEXTAUTH_SECRET || "fallback_secret_value_for_development",
  }
);

export const config = {
  matcher: [
    "/",
    // Role panel URLs — keep in step with ROLE_PANELS in lib/role-routes.ts.
    // Listed without `:path*` so sub-pages such as /admin/approvals are untouched
    // by the panel logic and fall through to the plain signed-in check below.
    "/admin",
    "/manager",
    "/cashier",
    "/accounts",
    "/hr",
    "/salesman",
    "/driver",
    "/supplier",
    "/dashboard/:path*",
    "/warehouse/:path*",
    "/sales/:path*",
    "/purchase/:path*",
    "/inventory/:path*",
    "/masters/:path*",
    "/vendors/:path*",
    "/suppliers/:path*",
    "/finance/:path*",
    "/staff/:path*",
    "/driver/:path*",
    "/admin/:path*",
    "/marketing/:path*",
    "/banking/:path*",
    "/accounting/:path*",
    "/gst/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/documents/:path*",
    "/external/:path*",
    "/login",
    "/api/:path*",
  ],
};
