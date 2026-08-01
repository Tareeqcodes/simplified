import type { GradeParams, SectionContext } from "./types";

/**
 * Shared across providers on purpose. Model vendors differ; what we ask of them
 * shouldn't. A new provider inherits these instructions unchanged.
 */
export const HOUSE_RULES = `
You are the study engine behind an exam-prep app for a final-year Agricultural
Economics and Extension student in Nigeria. You are given their lecturer's
handout. It is often a photocopy or scan, sometimes with typos, inconsistent
numbering, or hand-drawn figures — read it as it is and do not complain.

Non-negotiable rules:

1. GROUND EVERYTHING IN THE HANDOUT. Every explanation, definition, card and
   question must come from what this handout actually says. This student is
   graded by the lecturer who wrote it. Never silently substitute a textbook
   definition for the handout's own.
2. If the handout is genuinely unclear, say so plainly rather than inventing.
3. Write for someone smart but tired and short on time. Short sentences. No
   throat-clearing, no "it is important to note that".
4. Spell out every formula in words the first time, then give the symbolic form.
5. Examples should be Nigerian or West African, using naira where money is
   involved — but only where an example genuinely helps.
6. Never say "as an AI" or describe your own process.
`.trim();

/* ---------------- outline ---------------- */

export const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The handout's real topic title, cleaned up. Not the filename." },
    pageCount: { type: "integer", description: "Total pages." },
    sections: {
      type: "array",
      description: "The handout split into study-sized sections in reading order, covering every page.",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Use the handout's own wording where it has one." },
          pageStart: { type: "integer" },
          pageEnd: { type: "integer" },
        },
        required: ["heading", "pageStart", "pageEnd"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "pageCount", "sections"],
  additionalProperties: false,
} as const;

export function outlinePrompt(kind: "text" | "file") {
  const pages =
    kind === "text"
      ? "The handout text is marked with [[page N]] before each page. Use those numbers."
      : "Page numbers are PDF page positions starting at 1, not the numbers printed on the page.";

  return `
Read this handout and produce its outline. This is the structural pass — do not
explain anything yet.

Split it into sections a student would sit down and study in one go, roughly
1-3 pages each. Follow the handout's own headings where it has them; where it
runs on without headings, break at genuine topic changes and write an honest
heading yourself.

Rules:
- Cover every page. Ranges must be contiguous and must not overlap.
- Fold cover pages, blank pages and reference lists into a neighbouring section.
- Never more than 14 sections. Merge thin ones.
- ${pages}
`.trim();
}

/* ---------------- section digest ---------------- */

const KEY_TERMS = {
  type: "array",
  description: "Terms a student must be able to define in an exam. 3-8 of them. Skip general English words.",
  items: {
    type: "object",
    properties: {
      term: { type: "string" },
      definition: { type: "string", description: "One or two sentences, matching how this handout uses it." },
    },
    required: ["term", "definition"],
    additionalProperties: false,
  },
} as const;

const CARDS = {
  type: "array",
  description: "4-6 recall cards, each testing one fact. The front is a real question, never 'Term X?'. The back answers it in under 40 words.",
  items: {
    type: "object",
    properties: {
      front: { type: "string" },
      back: { type: "string" },
      page: { type: "integer" },
    },
    required: ["front", "back", "page"],
    additionalProperties: false,
  },
} as const;

const QUESTIONS = {
  type: "array",
  description: "2-3 practice questions in the style this material is examined. Match the handout's own emphasis — if it spends two pages on a calculation, one question should be a calculation.",
  items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["define", "explain", "calculate", "discuss"] },
      question: { type: "string" },
      marks: { type: "integer", description: "Realistic mark allocation, 2-20." },
      modelAnswer: { type: "string", description: "A full-mark answer written the way a student should write it, using only this handout." },
      mustMention: { type: "array", description: "The points an answer must contain to score well.", items: { type: "string" } },
    },
    required: ["kind", "question", "marks", "modelAnswer", "mustMention"],
    additionalProperties: false,
  },
} as const;

/**
 * `original` is only requested when the source is page images. On the text path
 * the app already holds the verbatim words locally, so asking the model to
 * retype them would be the single largest output cost in the app for no gain.
 */
export function sectionSchema(needsOriginal: boolean) {
  const properties: Record<string, unknown> = {
    gist: {
      type: "array",
      description: "The whole section in 3-5 bullets. Each is one standalone sentence carrying real content, not a topic label. This is what gets read the night before.",
      items: { type: "string" },
    },
    simplified: {
      type: "string",
      description: "The section rewritten in plain English as Markdown. Paragraphs of 2-4 sentences. Use ## for sub-headings, **bold** for key terms on first use, - for lists. Keep every fact, definition, formula and figure; only the language changes. Explain each formula in words before giving it symbolically.",
    },
    whyItMatters: {
      type: "string",
      description: "2-3 sentences on where this sits in the course and what it is used for. Concrete, not motivational filler.",
    },
    examTrap: {
      type: "string",
      description: "The specific mistake students make here — a confused distinction, a formula applied to the wrong case. Name it and state the correct version. If there is no real trap, say so in one sentence rather than inventing one.",
    },
    keyTerms: KEY_TERMS,
    cards: CARDS,
    questions: QUESTIONS,
  };

  const required = ["gist", "simplified", "whyItMatters", "examTrap", "keyTerms", "cards", "questions"];

  if (needsOriginal) {
    properties.original = {
      type: "string",
      description: "The section transcribed verbatim, as Markdown with paragraph breaks preserved. Do not paraphrase, correct or summarise. Describe unreadable figures in [square brackets].",
    };
    required.push("original");
  }

  return { type: "object", properties, required, additionalProperties: false };
}

export function sectionPrompt(ctx: SectionContext) {
  return `
Work only on the section titled "${ctx.heading}", pages ${ctx.pageStart} to
${ctx.pageEnd}${ctx.courseCode ? ` of the course ${ctx.courseCode}` : ""}.

Produce the study material for it.

The simplified rewrite is the point of this app. Someone should be able to read
it instead of the original and lose nothing they would be examined on. It should
be noticeably easier to read than the handout, and noticeably shorter, without
dropping a single examinable fact.
`.trim();
}

/* ---------------- grading ---------------- */

export const GRADE_SCHEMA = {
  type: "object",
  properties: {
    awarded: { type: "integer", description: "Marks awarded, 0 to the question's total. Be fair, not generous." },
    covered: {
      type: "array",
      description: "One entry per required point, in order. Say whether the answer actually made that point — in their own words counts, a vague gesture does not.",
      items: {
        type: "object",
        properties: {
          point: { type: "string", description: "The required point, restated verbatim." },
          hit: { type: "boolean" },
          note: { type: "string", description: "If hit, quote the phrase that earned it. If missed, say in a few words what was needed." },
        },
        required: ["point", "hit", "note"],
        additionalProperties: false,
      },
    },
    feedback: {
      type: "string",
      description: "2-3 sentences addressed to the student as 'you'. Lead with what they got right, then the single most valuable fix. No praise padding.",
    },
    missing: {
      type: "array",
      description: "Concrete things to add for full marks. Empty if they scored full marks.",
      items: { type: "string" },
    },
  },
  required: ["awarded", "covered", "feedback", "missing"],
  additionalProperties: false,
} as const;

export function gradePrompt(p: GradeParams) {
  return `
Mark this answer the way the lecturer who set it would.

SECTION: ${p.heading ?? "—"}
QUESTION (${p.marks} marks): ${p.question}

POINTS A FULL-MARK ANSWER MUST MAKE:
${(p.mustMention ?? []).map((x, i) => `${i + 1}. ${x}`).join("\n") || "(none listed)"}

FULL-MARK MODEL ANSWER:
${p.modelAnswer}

THE STUDENT'S ANSWER:
"""
${p.answer.trim()}
"""

Marking rules:
- Award marks for content, not length or polish. A short answer that makes the
  points scores full marks.
- Accept the student's own wording. Do not require the model answer's phrasing.
- Do not award marks for correct material the question did not ask for.
- If the answer is blank, off-topic or a guess, say so plainly and award 0.
- Do not inflate. A student who reads an inflated grade walks into the exam
  unprepared, which is the one outcome this app exists to prevent.
`.trim();
}
