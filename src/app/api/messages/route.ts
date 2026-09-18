import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";
import { addMessage, getMessagesSince, getMessageById } from "@/lib/store";

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
  const updatedSinceParam = req.nextUrl.searchParams.get("updatedSince");
  const updatedSince = updatedSinceParam ? Number(updatedSinceParam) : undefined;
  const { newMessages, updatedMessages } = getMessagesSince(after, updatedSince);
  return NextResponse.json({
    messages: newMessages,
    updatedMessages,
    serverTime: Date.now(),
  });
}

export async function POST(req: NextRequest) {
  const username = getUser(req);
  if (!username) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const text = body?.text?.toString().trim();
  const replyToId = body?.replyToId?.toString();
  if (!text) {
    return NextResponse.json({ error: "Message text required" }, { status: 400 });
  }

  const replyTo = replyToId ? getMessageById(replyToId) : undefined;

  const message = {
    id: randomUUID(),
    from: username,
    text,
    createdAt: Date.now(),
    ...(replyTo && {
      replyToId: replyTo.id,
      replyPreview: {
        from: replyTo.from,
        text: replyTo.text,
        mediaType: replyTo.mediaType,
        mediaName: replyTo.mediaName,
      },
    }),
  };
  addMessage(message);

  return NextResponse.json({ message });
}

