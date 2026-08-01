import { NextResponse } from "next/server";
import { describeError, provider } from "@/lib/providers";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { question, marks, modelAnswer, mustMention, answer, heading } =
      (await req.json()) as {
        question?: string;
        marks?: number;
        modelAnswer?: string;
        mustMention?: string[];
        answer?: string;
        heading?: string;
      };

    if (!question || !answer?.trim() || typeof marks !== "number") {
      return NextResponse.json({ error: "Missing answer to grade." }, { status: 400 });
    }

    const graded = await provider().grade({
      question,
      marks,
      modelAnswer: modelAnswer ?? "",
      mustMention: mustMention ?? [],
      answer,
      heading,
    });

    return NextResponse.json(graded);
  } catch (err) {
    const { message, status } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
