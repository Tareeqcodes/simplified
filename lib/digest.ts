"use client";

import { deleteHandout, getHandout, saveFile, saveHandout, saveReviews, uid } from "./db";
import { adoptDigest, adoptShared, findAnyDigest } from "./dedupe";
import { extractPdf, fullText, pageRangeText } from "./pdf";
import { checkFile, enforceQuota } from "./quota";
import { newReview } from "./schedule";
import { emptySection, type Card, type ExamQuestion, type Handout, type Section } from "./types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Progress {
  phase: "reading" | "uploading" | "outlining" | "digesting" | "done";
  done: number;
  total: number;
  label: string;
}

/**
 * What to send the model for a given part of a handout.
 *
 * Text handouts send only the pages in range — a few hundred tokens instead of
 * every page as an image on every call. Scans have no text layer, so they fall
 * back to the uploaded file.
 */
export function sourceFor(h: Handout, pageStart?: number, pageEnd?: number) {
  if (h.pages?.length && !h.isScanned) {
    return {
      text:
        pageStart && pageEnd
          ? pageRangeText(h.pages, pageStart, pageEnd)
          : fullText(h.pages),
    };
  }
  return { fileId: h.fileId };
}

/**
 * Upload → outline → digest each section.
 *
 * The first section runs alone on purpose: it writes the prompt cache for the
 * PDF, so the sections that follow read it back at a fraction of the cost
 * instead of every parallel call paying for a full pass over the document.
 */
export async function digestHandout(
  file: File,
  courseId: string,
  courseCode: string,
  onProgress: (p: Progress) => void,
  onUpdate: (h: Handout) => void,
): Promise<Handout> {
  const sizeIssue = checkFile(file);
  if (sizeIssue) throw new Error(sizeIssue);

  const id = uid();
  await saveFile(id, file);

  let handout: Handout = {
    id,
    courseId,
    title: file.name.replace(/\.pdf$/i, ""),
    filename: file.name,
    fileId: "",
    pageCount: 0,
    status: "uploading",
    createdAt: Date.now(),
    sections: [],
  };
  await saveHandout(handout);
  onUpdate(handout);

  const save = async (patch: Partial<Handout>) => {
    handout = { ...handout, ...patch };
    await saveHandout(handout);
    onUpdate(handout);
    return handout;
  };

  try {
    // Read the PDF locally first. If it has a text layer we never upload the
    // file at all, and every later call carries words instead of page images.
    onProgress({ phase: "reading", done: 0, total: 1, label: "Reading the PDF…" });

    // Extraction is an optimisation, never a requirement. If the browser can't
    // do it — an old engine, a malformed PDF, a blocked worker — fall back to
    // sending the file as pages. Slower and dearer, but the handout still works.
    let extracted: Awaited<ReturnType<typeof extractPdf>> | null = null;
    try {
      extracted = await extractPdf(file);
    } catch (err) {
      console.warn("PDF text extraction failed; falling back to page images.", err);
    }

    await save({
      pages: extracted && !extracted.isScanned ? extracted.pages : [],
      isScanned: extracted ? extracted.isScanned : true,
      fileHash: extracted?.fileHash,
      contentHash: extracted?.contentHash,
      pageCount: extracted?.pageCount ?? 0,
    });

    const pageIssue = checkFile(file, extracted?.pageCount);
    if (pageIssue) throw new Error(pageIssue);

    // Already digested this document — by you or by a classmate? Copy it and
    // stop. No model calls, no quota. This is what makes the app get cheaper as
    // more people use it rather than more expensive.
    const existing = await findAnyDigest(
      extracted?.fileHash,
      extracted?.contentHash,
      extracted?.pages,
    );
    if (existing) {
      onProgress({
        phase: "digesting",
        done: 1,
        total: 1,
        label:
          existing.source === "shared"
            ? "A classmate already did this one — copying it across"
            : "Already in your library — copying it across",
      });
      const copy =
        existing.source === "local"
          ? await adoptDigest(existing.match.handout, courseId, file.name)
          : await adoptShared(
              existing.digest,
              courseId,
              file.name,
              extracted!.contentHash,
              extracted?.fileHash,
            );
      await deleteHandout(id); // discard the placeholder we just created
      onUpdate(copy);
      onProgress({ phase: "done", done: 1, total: 1, label: "Ready" });
      return copy;
    }

    // Genuinely new work — the only path that costs anything, so this is where
    // the limit bites.
    await enforceQuota("handout");

    if (!extracted || extracted.isScanned) {
      onProgress({
        phase: "uploading",
        done: 0,
        total: 1,
        label: "Scanned handout — sending the pages…",
      });
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: form });
      const up = await upRes.json();
      if (!upRes.ok) throw new Error(up?.error ?? "Upload failed");
      await save({ fileId: up.fileId, status: "outlining" });
    } else {
      await save({ status: "outlining" });
    }

    onProgress({ phase: "outlining", done: 0, total: 1, label: "Working out the sections…" });
    const outline = await post<{
      title: string;
      pageCount: number;
      sections: { heading: string; pageStart: number; pageEnd: number }[];
    }>("/api/outline", sourceFor(handout));

    const sections: Section[] = outline.sections.map((s, i) =>
      emptySection(i, s.heading, s.pageStart, s.pageEnd),
    );

    await save({
      title: outline.title || handout.title,
      pageCount: outline.pageCount,
      sections,
      status: "digesting",
    });

    const total = sections.length;
    let done = 0;

    const runOne = async (index: number) => {
      const current = (await getHandout(id))!;
      const s = current.sections[index];

      current.sections[index] = { ...s, status: "running" };
      await save({ sections: [...current.sections] });

      try {
        const d = await post<{
          gist: string[];
          simplified: string;
          original?: string;
          whyItMatters: string;
          examTrap: string;
          keyTerms: { term: string; definition: string }[];
          cards: { front: string; back: string; page: number }[];
          questions: {
            kind: ExamQuestion["kind"];
            question: string;
            marks: number;
            modelAnswer: string;
            mustMention: string[];
          }[];
        }>("/api/section", {
          ...sourceFor(current, s.pageStart, s.pageEnd),
          heading: s.heading,
          pageStart: s.pageStart,
          pageEnd: s.pageEnd,
          courseCode,
        });

        // On the text path the model never transcribes anything — we already
        // hold the verbatim words, so the Original depth is filled for free.
        const original =
          d.original ??
          (current.pages?.length ? pageRangeText(current.pages, s.pageStart, s.pageEnd) : "");

        const cards: Card[] = d.cards.map((c) => ({
          id: uid(),
          handoutId: id,
          sectionId: s.id,
          front: c.front,
          back: c.back,
          page: c.page,
        }));

        const questions: ExamQuestion[] = d.questions.map((q) => ({
          id: uid(),
          handoutId: id,
          sectionId: s.id,
          kind: q.kind,
          question: q.question,
          marks: q.marks,
          modelAnswer: q.modelAnswer,
          mustMention: q.mustMention ?? [],
        }));

        const fresh = (await getHandout(id))!;
        fresh.sections[index] = {
          ...fresh.sections[index],
          ...d,
          original,
          cards,
          questions,
          status: "done",
        };
        await save({ sections: [...fresh.sections] });
        await saveReviews(cards.map((c) => newReview(c, courseId)));
      } catch (err) {
        const fresh = (await getHandout(id))!;
        fresh.sections[index] = { ...fresh.sections[index], status: "error" };
        await save({ sections: [...fresh.sections] });
        console.error(`Section "${s.heading}" failed:`, err);
      } finally {
        done += 1;
        onProgress({
          phase: "digesting",
          done,
          total,
          label: `Breaking down "${s.heading}"`,
        });
      }
    };

    onProgress({ phase: "digesting", done: 0, total, label: "Breaking down section 1…" });

    // First alone to warm the cache, then three at a time.
    await runOne(0);
    for (let i = 1; i < total; i += 3) {
      await Promise.all(
        sections.slice(i, i + 3).map((_, k) => runOne(i + k)),
      );
    }

    const final = (await getHandout(id))!;
    const allFailed = final.sections.every((s) => s.status === "error");
    await save({
      sections: final.sections,
      status: allFailed ? "error" : "ready",
      error: allFailed ? "Every section failed to digest." : undefined,
    });

    onProgress({ phase: "done", done: total, total, label: "Ready" });
    return handout;
  } catch (err) {
    await save({
      status: "error",
      error: err instanceof Error ? err.message : "Something went wrong",
    });
    throw err;
  }
}

/**
 * Digestion runs in the tab that started it, so closing that tab strands the
 * remaining sections as `pending` with the handout stuck on `digesting`.
 * This picks up exactly those and finishes the job.
 */
export async function resumeHandout(
  handoutId: string,
  courseCode: string,
  onProgress?: (p: Progress) => void,
  onUpdate?: (h: Handout) => void,
): Promise<void> {
  let start = await getHandout(handoutId);
  if (!start) return;
  // Nothing to resume if neither source of content survived.
  if (!start.fileId && !start.pages?.length) return;

  // If the outline itself failed there are no sections to resume — redo it.
  if (start.sections.length === 0) {
    onProgress?.({ phase: "outlining", done: 0, total: 1, label: "Working out the sections…" });
    try {
      const outline = await post<{
        title: string;
        pageCount: number;
        sections: { heading: string; pageStart: number; pageEnd: number }[];
      }>("/api/outline", sourceFor(start));

      start = {
        ...start,
        title: outline.title || start.title,
        pageCount: outline.pageCount || start.pageCount,
        sections: outline.sections.map((s, i) =>
          emptySection(i, s.heading, s.pageStart, s.pageEnd),
        ),
        status: "digesting",
        error: undefined,
      };
      await saveHandout(start);
      onUpdate?.(start);
    } catch (err) {
      const failed = {
        ...start,
        status: "error" as const,
        error: err instanceof Error ? err.message : "Could not read this handout.",
      };
      await saveHandout(failed);
      onUpdate?.(failed);
      return;
    }
  }

  const todo = start.sections
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.status !== "done");

  if (todo.length === 0) {
    if (start.status !== "ready") {
      await saveHandout({ ...start, status: "ready", error: undefined });
      onUpdate?.({ ...start, status: "ready" });
    }
    return;
  }

  let done = 0;
  const run = async (index: number) => {
    try {
      await retrySection(handoutId, index, courseCode);
    } catch {
      // retrySection already marked the section as errored.
    } finally {
      done += 1;
      const h = await getHandout(handoutId);
      if (h) onUpdate?.(h);
      onProgress?.({
        phase: "digesting",
        done,
        total: todo.length,
        label: `Resuming — ${done} of ${todo.length}`,
      });
    }
  };

  // Same shape as a fresh run: one alone to warm the cache, then in threes.
  await run(todo[0].index);
  for (let i = 1; i < todo.length; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map(({ index }) => run(index)));
  }

  const final = await getHandout(handoutId);
  if (final) {
    const anyDone = final.sections.some((s) => s.status === "done");
    await saveHandout({
      ...final,
      status: anyDone ? "ready" : "error",
      error: anyDone ? undefined : "Every section failed to digest.",
    });
    onUpdate?.(final);
  }
}

/** Retry a single section that failed the first time. */
export async function retrySection(handoutId: string, index: number, courseCode: string) {
  const h = await getHandout(handoutId);
  if (!h) return;
  const s = h.sections[index];

  h.sections[index] = { ...s, status: "running" };
  await saveHandout({ ...h });

  try {
    const d = await post<Record<string, unknown>>("/api/section", {
      ...sourceFor(h, s.pageStart, s.pageEnd),
      heading: s.heading,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      courseCode,
    });

    const original =
      (d.original as string | undefined) ??
      (h.pages?.length ? pageRangeText(h.pages, s.pageStart, s.pageEnd) : "");

    const cards: Card[] = (d.cards as { front: string; back: string; page: number }[]).map(
      (c) => ({
        id: uid(),
        handoutId,
        sectionId: s.id,
        front: c.front,
        back: c.back,
        page: c.page,
      }),
    );
    const questions: ExamQuestion[] = (
      d.questions as Omit<ExamQuestion, "id" | "handoutId" | "sectionId">[]
    ).map((q) => ({ ...q, id: uid(), handoutId, sectionId: s.id }));

    const fresh = (await getHandout(handoutId))!;
    fresh.sections[index] = {
      ...fresh.sections[index],
      ...(d as object),
      original,
      cards,
      questions,
      status: "done",
    } as Section;
    fresh.status = fresh.sections.some((x) => x.status === "error") ? fresh.status : "ready";
    await saveHandout({ ...fresh });
    await saveReviews(cards.map((c) => newReview(c, fresh.courseId)));
  } catch (err) {
    const fresh = (await getHandout(handoutId))!;
    fresh.sections[index] = { ...fresh.sections[index], status: "error" };
    await saveHandout({ ...fresh });
    throw err;
  }
}
