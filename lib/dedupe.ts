"use client";

import { listHandouts, saveHandout, saveReviews, uid } from "./db";
import { normaliseForHash } from "./pdf";
import { newReview } from "./schedule";
import { findShared, type SharedDigest } from "./shared";
import type { Card, ExamQuestion, Handout, Section } from "./types";

/**
 * Two-tier duplicate detection.
 *
 * Byte-identical copies are the minority in a class that shares files over
 * WhatsApp — every forward re-compresses the PDF, so the same handout arrives
 * with different bytes. Matching on normalised text catches those; matching on
 * bytes catches the rest instantly.
 */
export type MatchReason = "exact" | "content";

export interface DuplicateMatch {
  handout: Handout;
  reason: MatchReason;
  confidence: number;
}

/** Similarity of two normalised texts, by shared word-run overlap. 0..1. */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const shingles = (s: string) => {
    const words = s.split(" ").filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 4 < words.length; i += 2) set.add(words.slice(i, i + 5).join(" "));
    return set;
  };
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const s of A) if (B.has(s)) shared += 1;
  return shared / Math.min(A.size, B.size);
}

/**
 * Find an already-digested handout that is the same document.
 * Only ever matches handouts that finished digesting — half-processed ones
 * would hand the user an incomplete copy.
 */
export async function findDuplicate(
  fileHash: string | undefined,
  contentHash: string | undefined,
  pages: string[] | undefined,
): Promise<DuplicateMatch | null> {
  const all = (await listHandouts()).filter(
    (h) => h.status === "ready" && h.sections.some((s) => s.status === "done"),
  );

  if (fileHash) {
    const exact = all.find((h) => h.fileHash === fileHash);
    if (exact) return { handout: exact, reason: "exact", confidence: 1 };
  }

  if (contentHash) {
    const byContent = all.find((h) => h.contentHash === contentHash);
    if (byContent) return { handout: byContent, reason: "content", confidence: 1 };
  }

  // Near match: same handout re-exported with slightly different text runs.
  if (pages?.length) {
    const mine = normaliseForHash(pages.join(" "));
    if (mine.length > 400) {
      for (const h of all) {
        if (!h.pages?.length) continue;
        const score = textSimilarity(mine, normaliseForHash(h.pages.join(" ")));
        if (score >= 0.85) return { handout: h, reason: "content", confidence: score };
      }
    }
  }

  return null;
}

/**
 * Has anyone — you, or a classmate — already processed this document?
 * Checks your own library first (instant, offline), then the shared one.
 */
export async function findAnyDigest(
  fileHash: string | undefined,
  contentHash: string | undefined,
  pages: string[] | undefined,
): Promise<
  { source: "local"; match: DuplicateMatch } | { source: "shared"; digest: SharedDigest } | null
> {
  const local = await findDuplicate(fileHash, contentHash, pages);
  if (local) return { source: "local", match: local };

  const shared = await findShared(contentHash);
  if (shared) return { source: "shared", digest: shared };

  return null;
}

/** Turn a classmate's published digest into a handout in your own library. */
export async function adoptShared(
  digest: SharedDigest,
  courseId: string,
  filename: string,
  contentHash: string,
  fileHash?: string,
): Promise<Handout> {
  const id = uid();

  const sections: Section[] = digest.sections.map((s) => ({
    ...s,
    understood: false,
    cards: s.cards.map((c) => ({ ...c, id: uid(), handoutId: id })),
    questions: s.questions.map((q) => ({ ...q, id: uid(), handoutId: id })),
  }));

  const copy: Handout = {
    id,
    courseId,
    title: digest.title,
    filename,
    fileId: "",
    pageCount: digest.pageCount,
    status: "ready",
    createdAt: Date.now(),
    sections,
    isScanned: digest.isScanned,
    contentHash,
    fileHash,
  };

  await saveHandout(copy);
  await saveReviews(sections.flatMap((s) => s.cards).map((c) => newReview(c, courseId)));
  return copy;
}

/**
 * Copy an existing digest into a new handout. No model calls, no quota — the
 * work was already paid for once, and re-doing it would be pure waste.
 */
export async function adoptDigest(
  source: Handout,
  courseId: string,
  filename: string,
): Promise<Handout> {
  const id = uid();

  const sections = source.sections.map((s) => {
    const cards: Card[] = s.cards.map((c) => ({
      ...c,
      id: uid(),
      handoutId: id,
    }));
    const questions: ExamQuestion[] = s.questions.map((q) => ({
      ...q,
      id: uid(),
      handoutId: id,
    }));
    // Progress is personal — the copy starts unread even if the original wasn't.
    return { ...s, cards, questions, understood: false };
  });

  const copy: Handout = {
    ...source,
    id,
    courseId,
    filename,
    createdAt: Date.now(),
    sections,
    status: "ready",
    error: undefined,
  };

  await saveHandout(copy);
  await saveReviews(
    sections.flatMap((s) => s.cards).map((c) => newReview(c, courseId)),
  );

  return copy;
}
