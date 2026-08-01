/** Separates handout-grounded answer text from wider context in a streamed answer. */
export const BEYOND_MARKER = "===BEYOND===";

export type HandoutStatus =
  | "uploading"
  | "outlining"
  | "digesting"
  | "ready"
  | "error";

export type SectionStatus = "pending" | "running" | "done" | "error";

export type Depth = "gist" | "simplified" | "original";

export interface Course {
  id: string;
  code: string;
  createdAt: number;
}

export interface Term {
  term: string;
  definition: string;
}

export interface Card {
  id: string;
  handoutId: string;
  sectionId: string;
  front: string;
  back: string;
  page?: number;
}

export type QuestionKind = "define" | "explain" | "calculate" | "discuss";

export interface ExamQuestion {
  id: string;
  handoutId: string;
  sectionId: string;
  kind: QuestionKind;
  question: string;
  marks: number;
  modelAnswer: string;
  mustMention: string[];
}

export interface Section {
  id: string;
  index: number;
  heading: string;
  pageStart: number;
  pageEnd: number;
  status: SectionStatus;
  understood: boolean;

  /** Populated by the section digest pass. */
  gist: string[];
  simplified: string;
  original: string;
  whyItMatters: string;
  examTrap: string;
  keyTerms: Term[];
  cards: Card[];
  questions: ExamQuestion[];
}

export interface Handout {
  id: string;
  courseId: string;
  title: string;
  filename: string;
  /**
   * Files API id. Only set for scanned handouts, which have to be re-read as
   * images. Text handouts never leave the browser as a file.
   */
  fileId: string;
  pageCount: number;
  status: HandoutStatus;
  error?: string;
  createdAt: number;
  sections: Section[];

  /** Extracted text, one entry per page. Empty for scans. */
  pages?: string[];
  /** True when there was no usable text layer. */
  isScanned?: boolean;
  /** SHA-256 of the raw bytes — exact duplicates. */
  fileHash?: string;
  /** SHA-256 of the normalised text — re-compressed copies of the same handout. */
  contentHash?: string;
}

/** SM-2-style scheduling state, one row per card. */
export interface Review {
  cardId: string;
  handoutId: string;
  courseId: string;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  due: number; // epoch ms
  lastGrade?: 0 | 1 | 2 | 3;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Assistant answers are split so handout-grounded content stays distinct. */
  beyond?: string;
  pages?: number[];
  createdAt: number;
}

/** A graded attempt at one exam question. Feeds the dashboard's weak spots. */
export interface Attempt {
  id: string;
  questionId: string;
  handoutId: string;
  courseId: string;
  sectionId: string;
  answer: string;
  awarded: number;
  marks: number;
  feedback: string;
  missing: string[];
  covered: { point: string; hit: boolean; note: string }[];
  createdAt: number;
}

export interface Chat {
  id: string; // `${handoutId}:${sectionId}`
  handoutId: string;
  sectionId: string;
  turns: ChatTurn[];
}

export function emptySection(
  index: number,
  heading: string,
  pageStart: number,
  pageEnd: number,
): Section {
  return {
    id: `s${index}`,
    index,
    heading,
    pageStart,
    pageEnd,
    status: "pending",
    understood: false,
    gist: [],
    simplified: "",
    original: "",
    whyItMatters: "",
    examTrap: "",
    keyTerms: [],
    cards: [],
    questions: [],
  };
}
