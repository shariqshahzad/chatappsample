import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidUsername } from "@/lib/auth";
import { getMedia } from "@/lib/store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  if (!username || !isValidUsername(username)) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const entry = await getMedia(id);
  if (!entry) {
    return NextResponse.json(
      { error: "Media not found or expired" },
      { status: 404 }
    );
  }

  const buffer = entry.buffer;
  const total = buffer.length;
  const rangeHeader = req.headers.get("range");

  // Mobile browsers (especially iOS Safari) require HTTP Range support to
  // play audio/video reliably — without it, playback can silently fail or
  // never start, even though the same file plays fine on desktop.
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : total - 1;

      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end) start = 0;

      const chunk = buffer.subarray(start, end + 1);

      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers: {
          "Content-Type": entry.contentType,
          "Content-Disposition": `inline; filename="${entry.fileName}"`,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": entry.contentType,
      "Content-Disposition": `inline; filename="${entry.fileName}"`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(total),
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function HEAD(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = req.cookies.get(SESSION_COOKIE)?.value;
  if (!username || !isValidUsername(username)) {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await params;
  const entry = await getMedia(id);
  if (!entry) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": entry.contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(entry.buffer.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}
