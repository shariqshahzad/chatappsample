import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const username = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  return NextResponse.json({ username });
}
