import { NextResponse } from "next/server";
import { describeError, provider, type DocSource } from "@/lib/providers";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { fileId, text } = (await req.json()) as { fileId?: string; text?: string };

    // Text is the cheap path; the file id is the scan fallback.
    const src: DocSource | null = text?.trim()
      ? { kind: "text", text }
      : fileId
        ? { kind: "file", fileId }
        : null;

    if (!src) {
      return NextResponse.json({ error: "No handout content provided." }, { status: 400 });
    }

    const outline = await provider().outline(src);
    if (!outline.sections?.length) {
      return NextResponse.json(
        { error: "No readable sections were found in that PDF." },
        { status: 422 },
      );
    }
    return NextResponse.json(outline);
  } catch (err) {
    const { message, status } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
