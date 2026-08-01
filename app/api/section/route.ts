import { NextResponse } from "next/server";
import { describeError, provider, type DocSource } from "@/lib/providers";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { fileId, text, heading, pageStart, pageEnd, courseCode } = (await req.json()) as {
      fileId?: string;
      text?: string;
      heading?: string;
      pageStart?: number;
      pageEnd?: number;
      courseCode?: string;
    };

    if (!heading || !pageStart || !pageEnd) {
      return NextResponse.json({ error: "Missing section details." }, { status: 400 });
    }

    const src: DocSource | null = text?.trim()
      ? { kind: "text", text }
      : fileId
        ? { kind: "file", fileId }
        : null;

    if (!src) {
      return NextResponse.json({ error: "No handout content provided." }, { status: 400 });
    }

    const result = await provider().digestSection(src, {
      heading,
      pageStart,
      pageEnd,
      courseCode,
      // Only ask for a verbatim transcription when we couldn't extract one.
      needsOriginal: src.kind === "file",
    });

    return NextResponse.json(result);
  } catch (err) {
    const { message, status } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
