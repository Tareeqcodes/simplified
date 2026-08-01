"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card as Panel, Empty, Header, Pill } from "@/components/ui";
import { latestAttempts, listHandouts, saveAttempt, uid } from "@/lib/db";
import { enforceQuota } from "@/lib/quota";
import type { Attempt, ExamQuestion } from "@/lib/types";

interface Item {
  q: ExamQuestion;
  heading: string;
  handoutTitle: string;
  handoutId: string;
  courseId: string;
  last?: Attempt;
}

interface Graded {
  awarded: number;
  covered: { point: string; hit: boolean; note: string }[];
  feedback: string;
  missing: string[];
}

const KIND_LABEL: Record<ExamQuestion["kind"], string> = {
  define: "Definition",
  explain: "Explanation",
  calculate: "Calculation",
  discuss: "Discussion",
};

function ExamInner() {
  const params = useSearchParams();
  const handoutFilter = params.get("handout");
  const sectionFilter = params.get("section");

  const [items, setItems] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<Graded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scores, setScores] = useState<{ awarded: number; marks: number }[]>([]);
  const [startedAt] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  const load = useCallback(async () => {
    const [handouts, last] = await Promise.all([listHandouts(), latestAttempts()]);
    const list: Item[] = [];
    for (const h of handouts) {
      if (handoutFilter && h.id !== handoutFilter) continue;
      for (const s of h.sections) {
        if (sectionFilter && s.id !== sectionFilter) continue;
        for (const q of s.questions) {
          list.push({
            q,
            heading: s.heading,
            handoutTitle: h.title,
            handoutId: h.id,
            courseId: h.courseId,
            last: last.get(q.id),
          });
        }
      }
    }
    // Questions you've never attempted, or scored worst on, come first.
    list.sort((a, b) => {
      const ra = a.last ? a.last.awarded / a.last.marks : -1;
      const rb = b.last ? b.last.awarded / b.last.marks : -1;
      return ra - rb;
    });
    setItems(list);
    setLoaded(true);
  }, [handoutFilter, sectionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const item = items[i];
  const done = loaded && (!item || i >= items.length);
  const suggested = item ? Math.max(2, Math.round(item.q.marks * 1.5)) : 0;

  const totals = useMemo(
    () =>
      scores.reduce(
        (acc, s) => ({ awarded: acc.awarded + s.awarded, marks: acc.marks + s.marks }),
        { awarded: 0, marks: 0 },
      ),
    [scores],
  );

  async function submit() {
    if (!item || !answer.trim() || grading) return;
    setGrading(true);
    setError(null);
    try {
      // Marking counts against the same daily allowance as Ask.
      await enforceQuota("question");
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: item.q.question,
          marks: item.q.marks,
          modelAnswer: item.q.modelAnswer,
          mustMention: item.q.mustMention,
          answer,
          heading: item.heading,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Grading failed.");

      setResult(data as Graded);
      setScores((s) => [...s, { awarded: data.awarded, marks: item.q.marks }]);
      await saveAttempt({
        id: uid(),
        questionId: item.q.id,
        handoutId: item.handoutId,
        courseId: item.courseId,
        sectionId: item.q.sectionId,
        answer,
        awarded: data.awarded,
        marks: item.q.marks,
        feedback: data.feedback,
        missing: data.missing ?? [],
        covered: data.covered ?? [],
        createdAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grading failed.");
    } finally {
      setGrading(false);
    }
  }

  function next() {
    setResult(null);
    setAnswer("");
    setError(null);
    setI((n) => n + 1);
  }

  if (!loaded) {
    return (
      <div className="min-h-screen grid place-items-center">
        <span className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
          Assembling your paper…
        </span>
      </div>
    );
  }

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        title="Exam practice"
        subtitle={
          items.length ? `Question ${Math.min(i + 1, items.length)} of ${items.length}` : undefined
        }
        back={{ href: handoutFilter ? `/handout/${handoutFilter}` : "/", label: "Back" }}
      >
        {items.length > 0 && !done && (
          <span
            className="text-xs tabular-nums px-2 py-1 rounded-md"
            style={{ background: "var(--line)", color: "var(--ink-soft)" }}
            title="Time on this session"
          >
            {mm}
          </span>
        )}
      </Header>

      <main className="flex-1 mx-auto w-full max-w-[44rem] px-5 py-8">
        {done ? (
          <Panel className="p-2">
            <Empty
              title={items.length ? "Paper finished" : "No questions yet"}
              body={
                items.length
                  ? `You scored ${totals.awarded} of ${totals.marks} marks (${Math.round(
                      (totals.awarded / Math.max(1, totals.marks)) * 100,
                    )}%) in ${mm}. Questions you scored worst on will come first next time.`
                  : "Questions are written while a handout is digested. Add a handout, or wait for one to finish."
              }
              action={
                <div className="flex gap-2 justify-center">
                  <Link href="/">
                    <Button variant="outline">Back to courses</Button>
                  </Link>
                  {items.length > 0 && (
                    <Button
                      onClick={() => {
                        setI(0);
                        setScores([]);
                        setResult(null);
                        setAnswer("");
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
            <div className="rise" key={item.q.id}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Pill tone="accent">{KIND_LABEL[item.q.kind]}</Pill>
                <Pill>{item.heading}</Pill>
                <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                  {item.q.marks} marks · about {suggested} min
                </span>
                {item.last && (
                  <Pill tone={item.last.awarded / item.last.marks < 0.5 ? "warn" : "neutral"}>
                    last: {item.last.awarded}/{item.last.marks}
                  </Pill>
                )}
              </div>

              <Panel className="p-6 mb-4">
                <p className="prose-read text-[1.1rem] leading-snug">{item.q.question}</p>
              </Panel>

              {!result ? (
                <>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    disabled={grading}
                    rows={10}
                    autoFocus
                    placeholder="Write your answer as you would in the exam. Bullet points are fine if that's how you'd answer."
                    className="w-full rounded-xl border p-4 text-[14.5px] leading-relaxed resize-y disabled:opacity-60"
                    style={{
                      background: "var(--card)",
                      borderColor: "var(--line)",
                      color: "var(--ink)",
                      fontFamily: "var(--font-read)",
                    }}
                  />
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <Button onClick={submit} disabled={!answer.trim() || grading}>
                      {grading ? "Marking…" : "Submit for marking"}
                    </Button>
                    <button
                      onClick={next}
                      className="text-[12px] hover:underline"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      Skip this one
                    </button>
                    <span className="text-[11px] ml-auto" style={{ color: "var(--ink-faint)" }}>
                      {answer.trim().split(/\s+/).filter(Boolean).length} words
                    </span>
                  </div>
                  {error && (
                    <p className="text-xs mt-3" style={{ color: "var(--warn)" }}>
                      {error}
                    </p>
                  )}
                </>
              ) : (
                <div className="rise space-y-4">
                  <Panel className="p-5">
                    <div className="flex items-baseline gap-3 mb-3">
                      <span
                        className="text-2xl font-semibold tabular-nums"
                        style={{
                          color:
                            result.awarded / item.q.marks >= 0.7 ? "var(--accent)" : "var(--warn)",
                        }}
                      >
                        {result.awarded}/{item.q.marks}
                      </span>
                      <span className="text-sm" style={{ color: "var(--ink-soft)" }}>
                        {Math.round((result.awarded / item.q.marks) * 100)}%
                      </span>
                    </div>
                    <p className="text-[14px] leading-relaxed">{result.feedback}</p>
                  </Panel>

                  {result.covered.length > 0 && (
                    <Panel className="p-5">
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        Points the examiner looked for
                      </h3>
                      <ul className="space-y-2.5">
                        {result.covered.map((c, n) => (
                          <li key={n} className="flex gap-2.5 text-[13.5px]">
                            <span
                              className="shrink-0 mt-0.5"
                              style={{ color: c.hit ? "var(--accent)" : "var(--warn)" }}
                            >
                              {c.hit ? "✓" : "✕"}
                            </span>
                            <span>
                              <span style={{ color: "var(--ink)" }}>{c.point}</span>
                              {c.note && (
                                <span
                                  className="block text-[12px] mt-0.5"
                                  style={{ color: "var(--ink-faint)" }}
                                >
                                  {c.note}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                  )}

                  <details className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--line)" }}>
                    <summary
                      className="px-5 py-3 text-[13px] font-medium cursor-pointer hover:bg-[var(--accent-soft)]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      Full-mark answer
                    </summary>
                    <div className="px-5 pb-5">
                      <p className="prose-read text-[14px]">{item.q.modelAnswer}</p>
                    </div>
                  </details>

                  <details className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--line)" }}>
                    <summary
                      className="px-5 py-3 text-[13px] font-medium cursor-pointer hover:bg-[var(--accent-soft)]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      What you wrote
                    </summary>
                    <div className="px-5 pb-5">
                      <p className="verbatim">{answer}</p>
                    </div>
                  </details>

                  <div className="flex items-center gap-3 pt-1">
                    <Button onClick={next}>
                      {i < items.length - 1 ? "Next question →" : "Finish paper"}
                    </Button>
                    <Link
                      href={`/handout/${item.handoutId}`}
                      className="text-[12px] hover:underline"
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

export default function Exam() {
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
      <ExamInner />
    </Suspense>
  );
}
