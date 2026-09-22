import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";
import { addMedia, addMessage } from "@/lib/store";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export async function POST(req: NextRequest) {
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  if (!username || !isValidUsername(username)) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mediaId = randomUUID();

  await addMedia({
    id: mediaId,
    buffer,
    contentType: file.type || "application/octet-stream",
    fileName: file.name || "upload",
    createdAt: Date.now(),
  });

  const message = {
    id: randomUUID(),
    from: username,
    mediaId,
    mediaType: file.type || "application/octet-stream",
    mediaName: file.name || "upload",
    createdAt: Date.now(),
  };
  await addMessage(message);

  return NextResponse.json({ message });
}
