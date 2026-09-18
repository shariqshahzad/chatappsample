import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const username = body?.username?.toString().trim();
  const password = body?.password?.toString() ?? "";

  if (!username || !validateCredentials(username, password)) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, username, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day
  });
  return res;
}
