import { NextResponse } from "next/server";
import { describeError, provider } from "@/lib/providers";

export const maxDuration = 60;

/** Release a scanned handout's PDF from the provider's storage. */
export async function DELETE(req: Request) {
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "Missing fileId." }, { status: 400 });
  }
  try {
    await provider().deleteFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { message, status } = describeError(err);
    if (status === 404) return NextResponse.json({ ok: true, alreadyGone: true });
    return NextResponse.json({ error: message }, { status });
  }
}
