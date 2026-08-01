import { describeError, provider, type DocSource } from "@/lib/providers";

export const maxDuration = 300;

interface AskBody {
  fileId?: string;
  text?: string;
  question: string;
  heading?: string;
  pageStart?: number;
  pageEnd?: number;
  selection?: string;
  history?: { role: "user" | "assistant"; text: string }[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AskBody;
    if (!body?.question?.trim()) {
      return Response.json({ error: "Missing question." }, { status: 400 });
    }

    const src: DocSource | null = body.text?.trim()
      ? { kind: "text", text: body.text }
      : body.fileId
        ? { kind: "file", fileId: body.fileId }
        : null;

    if (!src) {
      return Response.json({ error: "No handout content provided." }, { status: 400 });
    }

    const stream = await provider().ask(src, {
      question: body.question,
      heading: body.heading,
      pageStart: body.pageStart,
      pageEnd: body.pageEnd,
      selection: body.selection,
      history: body.history,
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const { message, status } = describeError(err);
    return Response.json({ error: message }, { status });
  }
}
