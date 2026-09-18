import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";
import { toggleReaction } from "@/lib/store";

function getUser(req: NextRequest): string | null {
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  if (!username || !isValidUsername(username)) return null;
  return username;
}

export async function POST(req: NextRequest) {
  const username = getUser(req);
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const messageId = body?.messageId?.toString();
  const emoji = body?.emoji?.toString();

  if (!messageId || !emoji) {
    return NextResponse.json(
      { error: "messageId and emoji are required" },
      { status: 400 }
    );
  }

  const message = toggleReaction(messageId, username, emoji);
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json({ message });
}
