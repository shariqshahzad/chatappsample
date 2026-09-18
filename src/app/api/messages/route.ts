import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";
import { addMessage, getMessagesSince } from "@/lib/store";

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
  const after = req.nextUrl.searchParams.get("after");
  const messages = getMessagesSince(after);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const username = getUser(req);
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const text = body?.text?.toString().trim();
  if (!text) {
    return NextResponse.json({ error: "Message text required" }, { status: 400 });
  }

  const message = {
    id: randomUUID(),
    from: username,
    text,
    createdAt: Date.now(),
  };
  addMessage(message);

  return NextResponse.json({ message });
}
