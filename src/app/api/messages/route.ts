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
  const { newMessages, updatedMessages } = await getMessagesSince(after, updatedSince);
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
  const clientReplyPreview = body?.replyPreview;
  if (!text) {
    return NextResponse.json({ error: "Message text required" }, { status: 400 });
  }

  // Prefer the preview supplied by the client: it already has the exact
  // message it's replying to, rendered on screen. Falling back to a
  // server-side lookup alone is unreliable — the referenced message may
  // have been trimmed from history.
  const replyTo = replyToId ? await getMessageById(replyToId) : undefined;
  const replyPreview =
    clientReplyPreview && typeof clientReplyPreview === "object"
      ? {
          from: String(clientReplyPreview.from ?? ""),
          text: clientReplyPreview.text ? String(clientReplyPreview.text) : undefined,
          mediaType: clientReplyPreview.mediaType
            ? String(clientReplyPreview.mediaType)
            : undefined,
          mediaName: clientReplyPreview.mediaName
            ? String(clientReplyPreview.mediaName)
            : undefined,
        }
      : replyTo
      ? {
          from: replyTo.from,
          text: replyTo.text,
          mediaType: replyTo.mediaType,
          mediaName: replyTo.mediaName,
        }
      : undefined;

  const message = {
    id: randomUUID(),
    from: username,
    text,
    createdAt: Date.now(),
    ...((replyToId || replyPreview) && {
      ...(replyToId && { replyToId }),
      ...(replyPreview && { replyPreview }),
    }),
  };
  await addMessage(message);

  return NextResponse.json({ message });
}

