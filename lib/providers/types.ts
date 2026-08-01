import type { QuestionKind, Term } from "../types";

/**
 * How the model is given the handout.
 *
 * `text` is the cheap path: we extracted the characters in the browser and send
 * only the words we need. `file` is the fallback for scans, where there is no
 * text layer and the model has to look at the pages.
 */
export type DocSource =
  | { kind: "text"; text: string }
  | { kind: "file"; fileId: string };

export interface OutlineResult {
  title: string;
  pageCount: number;
  sections: { heading: string; pageStart: number; pageEnd: number }[];
}

export interface SectionResult {
  gist: string[];
  simplified: string;
  /** Omitted on the text path — we already hold the verbatim text locally. */
  original?: string;
  whyItMatters: string;
  examTrap: string;
  keyTerms: Term[];
  cards: { front: string; back: string; page: number }[];
  questions: {
    kind: QuestionKind;
    question: string;
    marks: number;
    modelAnswer: string;
    mustMention: string[];
  }[];
}

export interface SectionContext {
  heading: string;
  pageStart: number;
  pageEnd: number;
  courseCode?: string;
  /** True when the source is page images, so the model must transcribe. */
  needsOriginal: boolean;
}

export interface AskParams {
  question: string;
  heading?: string;
  pageStart?: number;
  pageEnd?: number;
  selection?: string;
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface GradeParams {
  question: string;
  marks: number;
  modelAnswer: string;
  mustMention: string[];
  answer: string;
  heading?: string;
}

export interface GradeResult {
  awarded: number;
  covered: { point: string; hit: boolean; note: string }[];
  feedback: string;
  missing: string[];
}

/**
 * Everything the app needs from a model vendor. Swapping providers means
 * writing one of these, not touching any route or component.
 */
export interface Provider {
  readonly name: string;
  outline(src: DocSource): Promise<OutlineResult>;
  digestSection(src: DocSource, ctx: SectionContext): Promise<SectionResult>;
  ask(src: DocSource, params: AskParams): Promise<ReadableStream<Uint8Array>>;
  grade(params: GradeParams): Promise<GradeResult>;

  /** Scans only — text handouts never upload the file anywhere. */
  uploadScan(file: File): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
  /** Whether this provider is configured well enough to run. */
  health(): { ok: boolean; message?: string };
}

/** Thrown when the model returns something the app can't use. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
