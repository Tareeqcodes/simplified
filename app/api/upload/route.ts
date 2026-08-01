import { NextResponse } from "next/server";
import { describeError, provider } from "@/lib/providers";

export const maxDuration = 120;

/**
 * Scans only. Handouts with a text layer are extracted in the browser and never
 * uploaded anywhere — which is also why this route stops being the bottleneck
 * for request-body size on most handouts.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF handouts are supported." }, { status: 400 });
    }
    if (file.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        { error: "That PDF is over 30MB. Split it or compress it first." },
        { status: 400 },
      );
    }

    const fileId = await provider().uploadScan(file);
    return NextResponse.json({ fileId });
  } catch (err) {
    const { message, status } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
