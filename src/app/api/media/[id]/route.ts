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
  const entry = getMedia(id);
  if (!entry) {
    return NextResponse.json(
      { error: "Media not found or expired" },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(entry.buffer), {
    status: 200,
    headers: {
      "Content-Type": entry.contentType,
      "Content-Disposition": `inline; filename="${entry.fileName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
