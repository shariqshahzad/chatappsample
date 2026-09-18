import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = !!username && isValidUsername(username);

  if (pathname.startsWith("/chat") && !authenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (pathname === "/" && authenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat"],
};
