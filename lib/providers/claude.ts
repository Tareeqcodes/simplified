import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { BEYOND_MARKER } from "../types";
import { GRADE_SCHEMA, gradePrompt, HOUSE_RULES, OUTLINE_SCHEMA, outlinePrompt, sectionPrompt, sectionSchema } from "./prompts";
import type {
  AskParams,
  DocSource,
  GradeParams,
  GradeResult,
  OutlineResult,
  Provider,
  SectionContext,
  SectionResult,
} from "./types";
import { ProviderError } from "./types";

const MODEL_DIGEST = process.env.CLAUDE_MODEL_DIGEST ?? "claude-sonnet-5";
const MODEL_OUTLINE = process.env.CLAUDE_MODEL_OUTLINE ?? "claude-sonnet-5";
const MODEL_ASK = process.env.CLAUDE_MODEL_ASK ?? "claude-sonnet-5";
const FILES_BETA = "files-api-2025-04-14";

let client: Anthropic | null = null;

function claude() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ProviderError(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
        401,
      );
    }
    client = new Anthropic();
  }
  return client;
}

/**
 * The handout as content blocks.
 *
 * The text path is the whole point of the extraction work: instead of shipping
 * every page as an image on every call, we send the words for the part we're
 * working on. Roughly 250 tokens a page instead of 2,000, and only the pages
 * that matter. The file path is unchanged and still marks the document as the
 * cache prefix, since scans have to be re-read as images each time.
 */
function docBlocks(src: DocSource): Anthropic.Beta.BetaContentBlockParam[] {
  if (src.kind === "text") {
    return [
      {
        type: "text",
        text: `<handout>\n${src.text}\n</handout>`,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  return [
    {
      type: "document",
      source: { type: "file", file_id: src.fileId },
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Only send the Files beta when we're actually referencing a file. An empty
 * `betas: []` still emits a blank anthropic-beta header, which the API rejects.
 */
function betas(src: DocSource) {
  return src.kind === "file" ? { betas: [FILES_BETA] } : {};
}

function readJson<T>(msg: Anthropic.Beta.BetaMessage): T {
  if (msg.stop_reason === "refusal") {
    throw new ProviderError("The model declined to process this document.", 422);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new ProviderError(
      "That section was too long to process in one pass. Try a smaller handout.",
      422,
    );
  }
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(`Model did not return valid JSON: ${text.slice(0, 200)}`, 502);
  }
}

export const claudeProvider: Provider = {
  name: "claude",

  async outline(src) {
    const msg = await claude().beta.messages.create({
      model: MODEL_OUTLINE,
      max_tokens: 8000,
      ...betas(src),
      system: HOUSE_RULES,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTLINE_SCHEMA },
      },
      messages: [
        { role: "user", content: [...docBlocks(src), { type: "text", text: outlinePrompt(src.kind) }] },
      ],
    });
    return readJson<OutlineResult>(msg);
  },

  async digestSection(src, ctx) {
    const msg = await claude().beta.messages.create({
      model: MODEL_DIGEST,
      max_tokens: 16000,
      ...betas(src),
      system: HOUSE_RULES,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: sectionSchema(ctx.needsOriginal) },
      },
      messages: [
        { role: "user", content: [...docBlocks(src), { type: "text", text: sectionPrompt(ctx) }] },
      ],
    });
    return readJson<SectionResult>(msg);
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
under 250 words unless the question genuinely needs more. Write prose, not
bullet lists, unless the answer is genuinely a list.`;

    const stream = claude().beta.messages.stream({
      model: MODEL_ASK,
      max_tokens: 4000,
      ...betas(src),
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [
        { role: "user", content: [...docBlocks(src), { type: "text", text: "This is the handout I am studying." }] },
        { role: "assistant", content: "Got it — ask me anything about it." },
        ...(params.history ?? []).slice(-6).map((t) => ({ role: t.role, content: t.text })),
        { role: "user", content: `${params.question.trim()}${selected}` },
      ],
    });

    const encoder = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            controller.enqueue(encoder.encode("\n\n[The model declined to answer that.]"));
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
        stream.abort();
      },
    });
  },

  async uploadScan(file) {
    const uploaded = await claude().beta.files.upload(
      { file },
      { headers: { "anthropic-beta": FILES_BETA } },
    );
    return uploaded.id;
  },

  async deleteFile(fileId) {
    try {
      await claude().beta.files.delete(fileId, { betas: [FILES_BETA] });
    } catch (err) {
      // Already gone is success from the caller's point of view.
      if (!(err instanceof Anthropic.NotFoundError)) throw err;
    }
  },

  health() {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key)
      return {
        ok: false,
        message:
          "No ANTHROPIC_API_KEY found. Create .env.local with ANTHROPIC_API_KEY=your-key, then restart the dev server. Note .env.example is only a template — Next.js does not read it.",
      };
    if (key.startsWith("sk-ant-..."))
      return { ok: false, message: "Your .env.local still has the placeholder key." };
    if (!key.startsWith("sk-ant-"))
      return { ok: false, message: "That doesn't look like an Anthropic key — they start with sk-ant-." };
    return { ok: true };
  },

  async grade(params) {
    const msg = await claude().beta.messages.create({
      model: MODEL_ASK,
      max_tokens: 4000,
      system: HOUSE_RULES,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: GRADE_SCHEMA },
      },
      messages: [{ role: "user", content: gradePrompt(params) }],
    });
    const graded = readJson<GradeResult>(msg);
    graded.awarded = Math.max(0, Math.min(params.marks, graded.awarded));
    return graded;
  },
};

/** Map SDK errors onto something the UI can show a student. */
export function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof ProviderError) return { message: err.message, status: err.status };
  if (err instanceof Anthropic.AuthenticationError)
    return { message: "The API key was rejected. Check .env.local.", status: 401 };
  if (err instanceof Anthropic.RateLimitError)
    return { message: "Rate limited. Wait a moment and try again.", status: 429 };
  if (err instanceof Anthropic.APIConnectionError)
    return { message: "Could not reach the model API. Check your connection.", status: 503 };
  if (err instanceof Anthropic.APIError)
    return { message: err.message, status: err.status ?? 500 };
  return { message: err instanceof Error ? err.message : "Unknown error", status: 500 };
}
