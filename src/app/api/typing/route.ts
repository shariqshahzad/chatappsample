import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidUsername, otherUser } from "@/lib/auth";
import { setTyping, clearTyping, isTyping } from "@/lib/store";

function getUser(req: NextRequest): string | null {
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  if (!username || !isValidUsername(username)) return null;
  return username;
}

export async function GET(req: NextRequest) {
  const username = getUser(req);
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const peer = otherUser(username);
  const typing = peer ? isTyping(peer) : false;
  return NextResponse.json({ typing });
}

export async function POST(req: NextRequest) {
  const username = getUser(req);
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (body?.typing === false) {
    clearTyping(username);
  } else {
    setTyping(username);
  }
  return NextResponse.json({ ok: true });
}
