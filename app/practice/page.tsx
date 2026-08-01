"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card as Panel, Empty, Header, Pill } from "@/components/ui";
import { listHandouts, listReviews, saveReview } from "@/lib/db";
import { grade } from "@/lib/schedule";
import type { Card, Handout, Review } from "@/lib/types";

interface Item {
  card: Card;
  review: Review;
  heading: string;
  handoutTitle: string;
  handoutId: string;
}

const GRADES = [
  { g: 0 as const, label: "Missed", key: "1", tone: "var(--warn)" },
  { g: 1 as const, label: "Hard", key: "2", tone: "var(--ink-soft)" },
  { g: 2 as const, label: "Good", key: "3", tone: "var(--accent)" },
  { g: 3 as const, label: "Easy", key: "4", tone: "var(--accent)" },
];

function PracticeInner() {
  const params = useSearchParams();
  const handoutFilter = params.get("handout");
  const sectionFilter = params.get("section");

  const [queue, setQueue] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });

  const load = useCallback(async () => {
    const [handouts, reviews] = await Promise.all([listHandouts(), listReviews()]);
    const byId = new Map(reviews.map((r) => [r.cardId, r]));

    const items: Item[] = [];
    for (const h of handouts as Handout[]) {
      if (handoutFilter && h.id !== handoutFilter) continue;
      for (const s of h.sections) {
        if (sectionFilter && s.id !== sectionFilter) continue;
        for (const c of s.cards) {
          const review = byId.get(c.id);
          if (!review) continue;
          // A targeted drill shows everything; the daily queue shows what's due.
          const scoped = Boolean(handoutFilter || sectionFilter);
          if (!scoped && review.due > Date.now()) continue;
          items.push({
            card: c,
            review,
            heading: s.heading,
            handoutTitle: h.title,
            handoutId: h.id,
          });
        }
      }
    }

    // Weakest first — the cards you keep dropping deserve the fresh attention.
    items.sort((a, b) => b.review.lapses - a.review.lapses || a.review.due - b.review.due);
    setQueue(items);
    setLoaded(true);
  }, [handoutFilter, sectionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const item = queue[i];
  const done = loaded && (!item || i >= queue.length);

  const answer = useCallback(
    async (g: 0 | 1 | 2 | 3) => {
      if (!item) return;
      await saveReview(grade(item.review, g));
      setTally((t) => (g === 0 ? { ...t, wrong: t.wrong + 1 } : { ...t, right: t.right + 1 }));
      setRevealed(false);
      setI((n) => n + 1);
    },
    [item],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!item) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const hit = GRADES.find((g) => g.key === e.key);
        if (hit) {
          e.preventDefault();
          answer(hit.g);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, item, answer]);

  const progress = useMemo(
    () => (queue.length ? Math.round((i / queue.length) * 100) : 0),
    [i, queue.length],
  );

  if (!loaded) {
    return (
      <div className="min-h-screen grid place-items-center">
        <span className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
          Building your queue…
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        title="Practice"
        subtitle={
          queue.length
            ? `${Math.min(i + 1, queue.length)} of ${queue.length}${
                sectionFilter ? " · section drill" : ""
              }`
            : undefined
        }
        back={{ href: handoutFilter ? `/handout/${handoutFilter}` : "/", label: "Back" }}
      />

      {queue.length > 0 && (
        <div className="h-0.5 shrink-0" style={{ background: "var(--line)" }}>
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${progress}%`, background: "var(--accent)" }}
          />
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-[38rem] px-5 py-10">
        {done ? (
          <Panel className="p-2">
            <Empty
              title={queue.length ? "Session done" : "Nothing due right now"}
              body={
                queue.length
                  ? `${tally.right} recalled, ${tally.wrong} missed. The ones you missed come back in ten minutes; the rest are scheduled further out.`
                  : "You're up to date. Read a new section, or drill a specific handout from its page."
              }
              action={
                <div className="flex gap-2 justify-center">
                  <Link href="/">
                    <Button variant="outline">Back to courses</Button>
                  </Link>
                  {queue.length > 0 && (
                    <Button
                      onClick={() => {
                        setI(0);
                        setTally({ right: 0, wrong: 0 });
                        setRevealed(false);
                        load();
                      }}
                    >
                      Go again
                    </Button>
                  )}
                </div>
              }
            />
          </Panel>
        ) : (
          item && (
            <div key={item.card.id} className="rise">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Pill>{item.heading}</Pill>
                {item.review.lapses >= 2 && <Pill tone="warn">missed {item.review.lapses}×</Pill>}
                {item.card.page && (
                  <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    p.{item.card.page}
                  </span>
                )}
              </div>

              <Panel className="p-7 mb-5 min-h-[13rem] flex flex-col justify-center">
                <p className="prose-read text-[1.2rem] leading-snug">{item.card.front}</p>

                {revealed && (
                  <div
                    className="mt-6 pt-5 border-t rise"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="prose-read text-[1.05rem]" style={{ color: "var(--ink-soft)" }}>
                      {item.card.back}
                    </p>
                  </div>
                )}
              </Panel>

              {!revealed ? (
                <div className="text-center">
                  <Button onClick={() => setRevealed(true)}>Show answer</Button>
                  <p className="text-[11px] mt-3" style={{ color: "var(--ink-faint)" }}>
                    or press space
                  </p>
                </div>
              ) : (
                <div className="rise">
                  <p
                    className="text-[11px] text-center mb-2.5"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    How well did you know it?
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {GRADES.map((g) => (
                      <button
                        key={g.g}
                        onClick={() => answer(g.g)}
                        className="rounded-lg border py-2.5 text-[13px] font-medium hover:bg-[var(--accent-soft)] transition-colors"
                        style={{ borderColor: "var(--line)", color: g.tone }}
                      >
                        {g.label}
                        <span className="block text-[10px] opacity-50 mt-0.5">{g.key}</span>
                      </button>
                    ))}
                  </div>
                  <div className="text-center mt-5">
                    <Link
                      href={`/handout/${item.handoutId}`}
                      className="text-[11px] hover:underline"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      Re-read “{item.heading}” →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}

export default function Practice() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center">
          <span className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
            Loading…
          </span>
        </div>
      }
    >
      <PracticeInner />
    </Suspense>
  );
}
