import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 calls this "proxy" (formerly "middleware").
// It runs before every matched request to:
//   1. refresh the Supabase session cookie so the login persists, and
//   2. send signed-out users away from /dashboard and /admin.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Pass refreshed cookies to the page being rendered...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // ...and back to the browser.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          // Stops CDNs from caching a response that carries a session.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value)
          );
        },
      },
    }
  );

  // Verifies the session and refreshes it if expired. Must run before
  // anything else so new cookies are written to the response.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

  const path = request.nextUrl.pathname;

  if (
    !isSignedIn &&
    (path.startsWith("/dashboard") || path.startsWith("/admin"))
  ) {
    return redirectWithCookies(request, response, "/login");
  }

  if (isSignedIn && path === "/login") {
    return redirectWithCookies(request, response, "/dashboard");
  }

  return response;
}

// A redirect is a new response, so copy over any refreshed session cookies
// and headers, otherwise the browser would lose them.
function redirectWithCookies(
  request: NextRequest,
  from: NextResponse,
  to: string
) {
  const redirect = NextResponse.redirect(new URL(to, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") redirect.headers.set(key, value);
  });
  return redirect;
}

export const config = {
  matcher: [
    // Run on everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
