"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddCourse, Uploader } from "@/components/Uploader";
import { SharedLibrary } from "@/components/SharedLibrary";
import { Button, Card, ConfirmDialog, Empty, Header, Icon, Meter, Pill } from "@/components/ui";
import { sharingConfigured } from "@/lib/appwrite";
import { deleteCourse, deleteHandout, latestAttempts, listCourses, listHandouts, listReviews, saveCourse, uid } from "@/lib/db";
import { resumeHandout } from "@/lib/digest";
import { readiness, weakSpots } from "@/lib/schedule";
import type { Attempt, Course, Handout, Review } from "@/lib/types";

export default function Dashboard() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [attempts, setAttempts] = useState<Map<string, Attempt>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [setupIssue, setSetupIssue] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const [libraryFor, setLibraryFor] = useState<Course | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setSetupIssue(h.ok ? null : h.message))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const [c, h, r, a] = await Promise.all([
      listCourses(),
      listHandouts(),
      listReviews(),
      latestAttempts(),
    ]);
    setCourses(c);
    setHandouts(h);
    setReviews(r);
    setAttempts(a);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    // Digestion runs in the background; keep the dashboard live while it does.
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const now = Date.now();
  const dueCount = useMemo(() => reviews.filter((r) => r.due <= now).length, [reviews, now]);
  const weak = useMemo(() => weakSpots(reviews), [reviews]);
  // Only questions you haven't answered yet — the count should fall as you work,
  // not sit at the total forever.
  const questionCount = useMemo(
    () =>
      handouts.reduce(
        (n, h) =>
          n + h.sections.reduce((m, s) => m + s.questions.filter((q) => !attempts.has(q.id)).length, 0),
        0,
      ),
    [handouts, attempts],
  );

  const weakTopics = useMemo(() => {
    // Where each card and each exam question lives, so a weak spot names a topic.
    const cardHeading = new Map<string, string>();
    const questionHeading = new Map<string, string>();
    for (const h of handouts)
      for (const s of h.sections) {
        for (const c of s.cards) cardHeading.set(c.id, s.heading);
        for (const q of s.questions) questionHeading.set(q.id, s.heading);
      }
    const counts = new Map<string, number>();
    const bump = (heading: string | undefined) => {
      if (heading) counts.set(heading, (counts.get(heading) ?? 0) + 1);
    };
    // Recall cards you keep dropping…
    for (const r of weak) bump(cardHeading.get(r.cardId));
    // …and exam answers you scored badly on last time.
    for (const a of attempts.values())
      if (a.marks > 0 && a.awarded / a.marks < 0.5) bump(questionHeading.get(a.questionId));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [weak, attempts, handouts]);

  async function addCourse(code: string) {
    await saveCourse({ id: uid(), code, createdAt: Date.now() });
    refresh();
  }

  if (!loaded) {
    return (
      <div className="min-h-screen grid place-items-center">
        <span className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
          Loading your library…
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        title="Simplified"
        subtitle="Exam prep, built from your own handouts"
      >
        {courses.length > 0 && (
          <Button size="sm" onClick={() => setShowUpload((v) => !v)}>
            <Icon name={showUpload ? "close" : "plus"} size={14} />
            {showUpload ? "Close" : "Handout"}
          </Button>
        )}
      </Header>

      <main className="mx-auto max-w-250 px-4 sm:px-6 py-8 sm:py-10">
        {setupIssue && (
          <div
            className="rounded-xl border p-4 mb-6 rise"
            style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}
          >
            <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--warn)" }}>
              Setup needed  uploads will fail until this is fixed
            </h2>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink)" }}>
              {setupIssue}
            </p>
          </div>
        )}

        {showUpload && courses.length > 0 && (
          <div className="mb-8">
            <Uploader courses={courses} onDone={refresh} />
          </div>
        )}

        {/* Study now — the reason to open the app on a normal day. */}
        {(dueCount > 0 || weakTopics.length > 0 || questionCount > 0) && (
          <Card className="p-5 sm:p-6 mb-8 rise">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                 
                  Study now
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                  {/* {dueCount > 0 && (
                    <span style={{ color: "var(--ink-soft)" }}>
                      <strong style={{ color: "var(--accent)" }}>{dueCount}</strong> card
                      {dueCount === 1 ? "" : "s"} due
                    </span>
                  )} */}
                  {questionCount > 0 && (
                    <span style={{ color: "var(--ink-soft)" }}>
                      <strong style={{ color: "var(--accent)" }}>{questionCount}</strong> exam
                      question{questionCount === 1 ? "" : "s"} to answer
                    </span>
                  )}
                  {weakTopics.length > 0 && (
                    <span style={{ color: "var(--ink-soft)" }}>
                      You keep missing:{" "}
                      <span style={{ color: "var(--warn)" }}>
                        {weakTopics.map(([t]) => t).join(", ")}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/exam">
                  <Button size="sm" variant="outline">
                    Exam practice
                  </Button>
                </Link>
                {dueCount > 0 && (
                  <Link href="/practice">
                    <Button size="sm">Start review →</Button>
                  </Link>
                )}
              </div>
            </div>
          </Card>
        )}

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-faint)" }}>
            My courses
          </h2>
          {courses.length > 0 && <AddCourse onAdd={addCourse} />}
        </div>

        {courses.length === 0 ? (
          <Card className="p-2">
            <Empty
              title=""
              body=" Add a course and upload its handouts to get started."
              action={<AddCourse onAdd={addCourse} />}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {courses.map((course) => {
              const cHandouts = handouts.filter((h) => h.courseId === course.id);
              const cards = cHandouts.flatMap((h) => h.sections.flatMap((s) => s.cards));
              const cReviews = reviews.filter((r) => r.courseId === course.id);
              const pct = readiness(cReviews, cards.length);
              const cWeak = cReviews.filter((r) => r.lapses >= 2).length;
              return (
                <Card
                  key={course.id}
                  className="p-5 rise transition-shadow duration-200 hover:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.28)]"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[15px]">{course.code}</h3>
                      {/* <p className="text-xs mt-1" style={{ color: "var(--ink-faint)" }}>
                        {cHandouts.length} handout{cHandouts.length === 1 ? "" : "s"} ·{" "}
                        {cards.length} card{cards.length === 1 ? "" : "s"}
                        {cWeak > 0 && ` · ${cWeak} weak spot${cWeak === 1 ? "" : "s"}`}
                      </p> */}
                    </div>
                    <button
                      onClick={() =>
                        setConfirming({
                          title: `Delete ${course.code}?`,
                          message: `This removes the course along with its handouts, cards and progress. This can't be undone.`,
                          confirmLabel: "Delete course",
                          onConfirm: () => deleteCourse(course.id).then(refresh),
                        })
                      }
                      className="grid place-items-center w-7 h-7 shrink-0 rounded-lg transition-colors hover:bg-(--warn-soft)"
                      style={{ color: "var(--ink-faint)" }}
                      title="Delete course"
                      aria-label="Delete course"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  {cards.length > 0 && (
                    <div className="mb-4">
                      <Meter value={pct} label={`${course.code} readiness`} />
                    </div>
                  )}

                  {cHandouts.length === 0 ? (
                    <Uploader courses={courses} defaultCourseId={course.id} onDone={refresh} />
                  ) : (
                    <div className="space-y-1">
                      {cHandouts.map((h) => {
                        const done = h.sections.filter((s) => s.status === "done").length;
                        const busy = h.status === "digesting" || h.status === "outlining" || h.status === "uploading";
                        // Digestion runs in the tab that started it. If that tab
                        // closed, sections sit unfinished with nothing driving them.
                        const stalled =
                          h.sections.length > 0 &&
                          h.sections.some((s) => s.status !== "done") &&
                          !h.sections.some((s) => s.status === "running") &&
                          resuming !== h.id;
                        return (
                          <div
                            key={h.id}
                            className="flex items-center gap-3 rounded-lg px-2.5 py-2 -mx-2.5 hover:bg-(--accent-soft) transition-colors group"
                          >
                            <Link href={`/handout/${h.id}`} className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="text-[13px] truncate">{h.title}</span>
                              {busy && (
                                <Pill tone="accent">
                                  <span className="pulsing inline-block w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                                  {h.status === "digesting"
                                    ? `${done}/${h.sections.length}`
                                    : "reading"}
                                </Pill>
                              )}
                              {h.status === "error" && <Pill tone="warn">failed</Pill>}
                              {h.status === "ready" && !stalled && (
                                <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                                  {h.sections.length} sections
                                </span>
                              )}
                            </Link>

                            {stalled && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  setResuming(h.id);
                                  resumeHandout(h.id, course.code)
                                    .then(refresh)
                                    .finally(() => setResuming(null));
                                }}
                                className="text-[11px] rounded-full px-2 py-0.5 font-medium shrink-0"
                                style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
                                title={`${h.sections.length - done} section(s) unfinished`}
                              >
                                Resume {h.sections.length - done}
                              </button>
                            )}
                            {resuming === h.id && (
                              <Pill tone="accent">
                                <span className="pulsing inline-block w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} /> resuming
                              </Pill>
                            )}
                            <button
                              onClick={() =>
                                setConfirming({
                                  title: "Delete handout?",
                                  message: (
                                    <>
                                      “{h.title}” and everything generated from it will be removed.
                                      This can&apos;t be undone.
                                    </>
                                  ),
                                  confirmLabel: "Delete handout",
                                  onConfirm: () => deleteHandout(h.id).then(refresh),
                                })
                              }
                              className="grid place-items-center w-6 h-6 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-(--warn-soft)"
                              style={{ color: "var(--ink-faint)" }}
                              title="Delete handout"
                              aria-label="Delete handout"
                            >
                              <Icon name="close" size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {sharingConfigured && (
                    <button
                      onClick={() => setLibraryFor(course)}
                      className="mt-3 -ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition-colors hover:bg-(--accent-soft)"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      <Icon name="share" size={13} />
                      Add from shared library
                    </button>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-[11px] mt-10 text-center leading-relaxed" style={{ color: "var(--ink-faint)" }}>

        </p>
      </main>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.title ?? ""}
        message={confirming?.message ?? ""}
        confirmLabel={confirming?.confirmLabel}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          confirming?.onConfirm();
          setConfirming(null);
        }}
      />

      {libraryFor && (
        <SharedLibrary
          course={libraryFor}
          onClose={() => setLibraryFor(null)}
          onAdopted={refresh}
        />
      )}
    </div>
  );
}
