import "server-only";
import { BEYOND_MARKER } from "../types";
import {
  GRADE_SCHEMA,
  gradePrompt,
  HOUSE_RULES,
  OUTLINE_SCHEMA,
  outlinePrompt,
  sectionPrompt,
  sectionSchema,
} from "./prompts";
import type {
  DocSource,
  GradeResult,
  OutlineResult,
  Provider,
  SectionResult,
} from "./types";
import { ProviderError } from "./types";

const API = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD = "https://generativelanguage.googleapis.com/upload/v1beta";

// Rolling "-latest" aliases so a model retirement can't break the app again
// (gemini-2.5-flash was pulled for new keys). Pin a version via env if you want.
const MODEL_DIGEST = process.env.GEMINI_MODEL_DIGEST ?? "gemini-flash-latest";
const MODEL_OUTLINE = process.env.GEMINI_MODEL_OUTLINE ?? "gemini-flash-latest";
const MODEL_ASK = process.env.GEMINI_MODEL_ASK ?? "gemini-flash-latest";

/**
 * Flash models think before answering, which is latency we don't need for
 * schema-constrained work where the shape is fixed and the source is right
 * there. We cap it to a minimal budget instead of paying for a full dynamic
 * pass. Note: current models reject a budget of 0 (400), so LOW_THINKING is the
 * floor; a budget of 0 here omits the config and lets the model decide. The
 * section rewrite is the one job where more reasoning can help the prose — bump
 * GEMINI_SECTION_THINKING (e.g. 512) if it dips.
 */
const LOW_THINKING = 128;
const SECTION_THINKING_BUDGET = Number(process.env.GEMINI_SECTION_THINKING ?? LOW_THINKING);
const thinking = (budget: number) =>
  budget > 0 ? { thinkingConfig: { thinkingBudget: budget } } : {};

function key(): string {
  const k = process.env.GEMINI_API_KEY?.trim();
  if (!k) {
    throw new ProviderError(
      "GEMINI_API_KEY is not set. Add it to .env.local, or set AI_PROVIDER=claude.",
      401,
    );
  }
  return k;
}

/**
 * Gemini's responseSchema is an OpenAPI subset, not full JSON Schema: it
 * rejects `additionalProperties`, and ordering of object keys is only stable
 * if you ask for it. Everything else in our shared schemas carries over.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    out[k] = toGeminiSchema(v);
  }
  if (out.type === "object" && out.properties) {
    out.propertyOrdering = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

/** The handout as Gemini parts — text inline, scans by uploaded file URI. */
function docParts(src: DocSource): Record<string, unknown>[] {
  return src.kind === "text"
    ? [{ text: `<handout>\n${src.text}\n</handout>` }]
    : [{ file_data: { mime_type: "application/pdf", file_uri: src.fileId } }];
}

async function call(
  model: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/models/${model}:generateContent?key=${key()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string; status?: string } | undefined;
    // Free-tier throttling is the failure a class of students will actually hit.
    if (res.status === 429) {
      throw new ProviderError(
        "The free tier is busy right now — too many requests at once. Wait a minute and try again.",
        429,
      );
    }
    throw new ProviderError(err?.message ?? `Gemini error ${res.status}`, res.status);
  }
  return data;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

function readJson<T>(data: Record<string, unknown>): T {
  const candidates = data.candidates as GeminiCandidate[] | undefined;
  const first = candidates?.[0];

  if (first?.finishReason === "SAFETY" || first?.finishReason === "PROHIBITED_CONTENT") {
    throw new ProviderError("The model declined to process this document.", 422);
  }
  if (first?.finishReason === "MAX_TOKENS") {
    throw new ProviderError(
      "That section was too long to process in one pass. Try a smaller handout.",
      422,
    );
  }

  const text = (first?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ProviderError("Gemini returned an empty response.", 502);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(`Gemini did not return valid JSON: ${text.slice(0, 200)}`, 502);
  }
}

function jsonConfig(schema: unknown) {
  return {
    responseMimeType: "application/json",
    responseSchema: toGeminiSchema(schema),
  };
}

export const geminiProvider: Provider = {
  name: "gemini",

  async outline(src) {
    const data = await call(MODEL_OUTLINE, {
      systemInstruction: { parts: [{ text: HOUSE_RULES }] },
      contents: [{ role: "user", parts: [...docParts(src), { text: outlinePrompt(src.kind) }] }],
      generationConfig: { ...jsonConfig(OUTLINE_SCHEMA), maxOutputTokens: 8000, ...thinking(LOW_THINKING) },
    });
    return readJson<OutlineResult>(data);
  },

  async digestSection(src, ctx) {
    const data = await call(MODEL_DIGEST, {
      systemInstruction: { parts: [{ text: HOUSE_RULES }] },
      contents: [{ role: "user", parts: [...docParts(src), { text: sectionPrompt(ctx) }] }],
      generationConfig: {
        ...jsonConfig(sectionSchema(ctx.needsOriginal)),
        maxOutputTokens: 16000,
        ...thinking(SECTION_THINKING_BUDGET),
      },
    });
    return readJson<SectionResult>(data);
  },

  async ask(src, params) {
    const scope = params.heading
      ? `The student is reading the section "${params.heading}" (pages ${params.pageStart}-${params.pageEnd}). Answer in that context unless they clearly mean something else.`
      : "The student is reading this handout.";

    const selected = params.selection?.trim()
      ? `\n\nThey highlighted this passage:\n"""\n${params.selection.trim()}\n"""`
      : "";

    const system = `${HOUSE_RULES}

You are answering a question while the student reads. ${scope}

Answer in two parts, separated by a line containing exactly ${BEYOND_MARKER}:

PART 1 — what this handout says. Use only the handout. Cite the page like (p.7)
when you draw on a specific passage. If the handout doesn't cover it, say
"This handout doesn't cover that" in one line and move to part 2.

PART 2 — the wider picture. Context, a clearer analogy, or standard theory the
handout leaves out. Omit this part entirely — no marker, no heading — when the
handout fully answers the question. Never pad it.

Do not label the parts; the app renders them separately. Keep the whole answer
under 250 words unless the question genuinely needs more.`;

    const contents = [
      { role: "user", parts: [...docParts(src), { text: "This is the handout I am studying." }] },
      { role: "model", parts: [{ text: "Got it — ask me anything about it." }] },
      ...(params.history ?? []).slice(-6).map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.text }],
      })),
      { role: "user", parts: [{ text: `${params.question.trim()}${selected}` }] },
    ];

    const res = await fetch(
      `${API}/models/${MODEL_ASK}:streamGenerateContent?alt=sse&key=${key()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: 4000 },
        }),
      },
    );

    if (!res.ok || !res.body) {
      const body = await res.text();
      if (res.status === 429) {
        throw new ProviderError(
          "The free tier is busy right now — too many requests at once. Wait a minute and try again.",
          429,
        );
      }
      throw new ProviderError(`Gemini error ${res.status}: ${body.slice(0, 200)}`, res.status);
    }

    // Gemini streams SSE frames; the app's clients expect plain text deltas.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    return new ReadableStream({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const frames = buffer.split("\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              if (!frame.startsWith("data:")) continue;
              const payload = frame.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload) as { candidates?: GeminiCandidate[] };
                const text = (parsed.candidates?.[0]?.content?.parts ?? [])
                  .map((p) => p.text ?? "")
                  .join("");
                if (text) controller.enqueue(encoder.encode(text));
              } catch {
                // Partial frame — the next chunk completes it.
              }
            }
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`\n\n[Error: ${err instanceof Error ? err.message : "failed"}]`),
          );
        } finally {
          controller.close();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });
  },

  async grade(params) {
    const data = await call(MODEL_ASK, {
      systemInstruction: { parts: [{ text: HOUSE_RULES }] },
      contents: [{ role: "user", parts: [{ text: gradePrompt(params) }] }],
      generationConfig: { ...jsonConfig(GRADE_SCHEMA), maxOutputTokens: 4000, ...thinking(LOW_THINKING) },
    });
    const graded = readJson<GradeResult>(data);
    graded.awarded = Math.max(0, Math.min(params.marks, graded.awarded));
    return graded;
  },

  async uploadScan(file) {
    const bytes = await file.arrayBuffer();
    const res = await fetch(`${UPLOAD}/files?key=${key()}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "raw",
        "Content-Type": "application/pdf",
        "X-Goog-Upload-File-Name": file.name,
      },
      body: bytes,
    });
    const data = (await res.json()) as { file?: { uri?: string }; error?: { message?: string } };
    if (!res.ok || !data.file?.uri) {
      throw new ProviderError(data.error?.message ?? `Gemini upload failed (${res.status})`, res.status);
    }
    return data.file.uri;
  },

  async deleteFile(fileId) {
    // fileId is a full URI; the delete endpoint wants the trailing files/<id>.
    const name = fileId.split("/v1beta/")[1] ?? fileId;
    await fetch(`${API}/${name}?key=${key()}`, { method: "DELETE" }).catch(() => {});
  },

  health() {
    const k = process.env.GEMINI_API_KEY?.trim();
    if (!k)
      return {
        ok: false,
        message:
          "AI_PROVIDER is gemini but GEMINI_API_KEY is not set. Add it to .env.local, or set AI_PROVIDER=claude.",
      };
    return { ok: true };
  },
};
