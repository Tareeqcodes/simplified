"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { Button, Header, Icon, IconButton, Pill } from "@/components/ui";
import { getCourse, getHandout, saveHandout } from "@/lib/db";
import { resumeHandout, retrySection } from "@/lib/digest";
import { sharingConfigured } from "@/lib/appwrite";
import { isShared, publishShared } from "@/lib/shared";
import { Markdown } from "@/lib/markdown";
import type { Course, Depth, Handout, Term } from "@/lib/types";

const DEPTHS: { key: Depth; label: string; hint: string }[] = [
  { key: "gist", label: "Gist", hint: "The whole section in a few lines" },
  { key: "simplified", label: "Simplified", hint: "Plain English, nothing examinable lost" },
  { key: "original", label: "Original", hint: "Your lecturer's exact words" },
];

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [handout, setHandout] = useState<Handout | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [active, setActive] = useState(0);
  const [depth, setDepth] = useState<Depth>("simplified");
  const [term, setTerm] = useState<Term | null>(null);
  const [selection, setSelection] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "done">("idle");
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [alreadyShared, setAlreadyShared] = useState(false);
  const readRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const h = await getHandout(id);
    if (!h) return;
    setHandout(h);
    if (!course) setCourse((await getCourse(h.courseId)) ?? null);
  }, [id, course]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (sharingConfigured && handout?.contentHash) {
      isShared(handout.contentHash).then(setAlreadyShared);
    }
  }, [handout?.contentHash]);

  // Keep polling only while sections are still being digested.
  useEffect(() => {
    if (!handout || handout.status === "ready" || handout.status === "error") return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [handout, refresh]);

  const section = handout?.sections[active];
  const depthPref = useMemo(() => DEPTHS.findIndex((d) => d.key === depth), [depth]);

  useEffect(() => {
    const saved = localStorage.getItem("depth") as Depth | null;
    if (saved) setDepth(saved);
  }, []);

  useEffect(() => {
    readRef.current?.scrollTo({ top: 0 });
  }, [active, depth]);

  function pickDepth(d: Depth) {
    setDepth(d);
    localStorage.setItem("depth", d);
  }

  async function toggleUnderstood() {
    if (!handout || !section) return;
    const sections = [...handout.sections];
    sections[active] = { ...section, understood: !section.understood };
    const next = { ...handout, sections };
    setHandout(next);
    await saveHandout(next);
    if (!section.understood && active < sections.length - 1) setActive(active + 1);
  }

  function captureSelection() {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text.length > 3) setSelection(text);
  }

  if (!handout) {
    return (
      <div className="min-h-screen grid place-items-center">
        <span className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
          Opening handout…
        </span>
      </div>
    );
  }

  const doneCount = handout.sections.filter((s) => s.status === "done").length;
  const understoodCount = handout.sections.filter((s) => s.understood).length;
  const busy = handout.status !== "ready" && handout.status !== "error";

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={handout.title}
        subtitle={course?.code}
        back={{ href: "/", label: "Courses" }}
      >
        <div className="lg:hidden">
          <IconButton icon="menu" onClick={() => setSidebar((v) => !v)} label="Sections" />
        </div>
        <Link href={`/practice?handout=${handout.id}`} className="hidden sm:block">
          <Button size="sm" variant="outline">
            Cards
          </Button>
        </Link>
        <Link href={`/exam?handout=${handout.id}`} className="hidden sm:block">
          <Button size="sm" variant="outline">
            Exam
          </Button>
        </Link>
        {sharingConfigured && handout.status === "ready" && (
          <Button
            size="sm"
            variant="outline"
            // Only blocked while a share is actually in flight. Re-sharing is
            // allowed and expected — the digest changes when sections are
            // retried or re-digested, and the shared copy should keep up.
            disabled={shareState === "sharing"}
            onClick={async () => {
              setShareState("sharing");
              const r = await publishShared(handout, course?.code ?? "");
              setShareState("idle");
              setAlreadyShared(r.ok);
              setShareMsg(r.message);
              setTimeout(() => setShareMsg(null), 6000);
            }}
            title={
              alreadyShared
                ? "Re-share to update the copy your classmates get"
                : "Publish this digest so classmates don't have to process it again"
            }
          >
            <Icon name="share" size={13} />
            {shareState === "sharing" ? "Sharing…" : alreadyShared ? "Shared" : "Share"}
          </Button>
        )}
      </Header>

      {shareMsg && (
        <div
          className="px-4 py-2 text-[12px] text-center border-b rise"
          style={{ background: "var(--accent-soft)", borderColor: "var(--line)" }}
        >
          {shareMsg}
          {alreadyShared && " Classmates who upload this handout now get it instantly, free."}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* ── Sections + key terms */}
        <aside
          className={`${
            sidebar ? "flex" : "hidden"
          } lg:flex w-64 shrink-0 flex-col border-r overflow-y-auto scroll-thin absolute lg:relative z-20 h-full`}
          style={{ borderColor: "var(--line)", background: "var(--card)" }}
        >
          <div className="px-4 py-3 border-b sticky top-0" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
                Sections
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: "var(--ink-faint)" }}>
                {understoodCount}/{handout.sections.length}
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
              <div
                className="h-full transition-[width] duration-500"
                style={{
                  width: `${(understoodCount / Math.max(1, handout.sections.length)) * 100}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          </div>

          <nav className="p-2">
            {handout.sections.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setActive(i);
                  setSidebar(false);
                }}
                className="w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors flex items-start gap-2"
                style={{
                  background: i === active ? "var(--accent-soft)" : "transparent",
                }}
              >
                <span className="text-[11px] mt-0.5 shrink-0 w-3.5" style={{ color: "var(--ink-faint)" }}>
                  {s.understood ? (
                    <span style={{ color: "var(--accent)" }}>✓</span>
                  ) : s.status === "running" ? (
                    <span className="pulsing inline-block w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                  ) : s.status === "error" ? (
                    <span style={{ color: "var(--warn)" }}>!</span>
                  ) : s.status === "pending" ? (
                    "○"
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className="text-[13px] leading-snug"
                  style={{
                    color: i === active ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: i === active ? 600 : 400,
                  }}
                >
                  {s.heading}
                </span>
              </button>
            ))}
          </nav>

          {section && section.keyTerms.length > 0 && (
            <div className="p-4 border-t mt-auto" style={{ borderColor: "var(--line)" }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ink-faint)" }}>
                Key terms
              </h3>
              <div className="space-y-1">
                {section.keyTerms.map((t) => (
                  <button
                    key={t.term}
                    onClick={() => setTerm(t)}
                    className="block text-left text-[12.5px] hover:underline"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    · {t.term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Reading pane ─────────────────────────────────────── */}
        <main ref={readRef} className="flex-1 overflow-y-auto scroll-thin min-w-0">
          <div className="mx-auto max-w-2xl px-5 sm:px-8 py-8">
            {!section ? (
              busy ? (
                <p className="pulsing text-sm" style={{ color: "var(--ink-faint)" }}>
                  Still reading the handout…
                </p>
              ) : (
                // Show what actually went wrong rather than a dead end.
                <div className="rounded-xl border p-5" style={{ borderColor: "var(--line)" }}>
                  <h2 className="text-sm font-semibold mb-2">This handout didn&apos;t process</h2>
                  <p className="text-[13px] leading-relaxed mb-4" style={{ color: "var(--ink-soft)" }}>
                    {handout.error ??
                      "No sections came back. The PDF may be empty, password-protected, or corrupted."}
                  </p>
                  <Button
                    onClick={() =>
                      resumeHandout(handout.id, course?.code ?? "").then(refresh)
                    }
                  >
                    Try again
                  </Button>
                </div>
              )
            ) : (
              <>
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--ink-faint)" }}>
                      Section {active + 1} of {handout.sections.length} · pp.{" "}
                      {section.pageStart}–{section.pageEnd}
                    </span>
                    {busy && <Pill tone="accent">{doneCount}/{handout.sections.length} digested</Pill>}
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight leading-tight">
                    {section.heading}
                  </h1>
                </div>

                {section.status === "done" ? (
                  <>
                    {/* Depth dial — the core control of the whole app. */}
                    <div className="mb-7">
                      <div
                        className="inline-flex rounded-lg border p-0.5"
                        style={{ borderColor: "var(--line)", background: "var(--card)" }}
                        role="radiogroup"
                        aria-label="Reading depth"
                      >
                        {DEPTHS.map((d, i) => (
                          <button
                            key={d.key}
                            role="radio"
                            aria-checked={depth === d.key}
                            onClick={() => pickDepth(d.key)}
                            className="text-[12.5px] px-3 py-1.5 rounded-md transition-all font-medium"
                            style={{
                              background: depth === d.key ? "var(--accent)" : "transparent",
                              color: depth === d.key ? "#fff" : "var(--ink-soft)",
                            }}
                            title={d.hint}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] mt-2" style={{ color: "var(--ink-faint)" }}>
                        {DEPTHS[depthPref]?.hint}
                      </p>
                    </div>

                    <div onMouseUp={captureSelection} onTouchEnd={captureSelection}>
                      {depth === "gist" && (
                        <ul className="space-y-3.5 rise">
                          {section.gist.map((g, i) => (
                            <li key={i} className="flex gap-3">
                              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                              <span className="prose-read text-[1.05rem] leading-relaxed">{g}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {depth === "simplified" && (
                        <div className="rise">
                          <Markdown
                            text={section.simplified}
                            terms={section.keyTerms}
                            onTerm={setTerm}
                          />
                        </div>
                      )}

                      {depth === "original" && (
                        <div className="rise">
                          <p className="text-[11px] mb-3" style={{ color: "var(--ink-faint)" }}>
                            Transcribed exactly as printed, pages {section.pageStart}–
                            {section.pageEnd}. Typos and all.
                          </p>
                          <div className="verbatim">{section.original}</div>
                        </div>
                      )}
                    </div>

                    {/* Supporting context, collapsed so it never competes with the reading. */}
                    <div className="mt-8 space-y-2">
                      <Disclosure title="Why it matters" body={section.whyItMatters} />
                      <Disclosure title="Common exam trap" body={section.examTrap} tone="warn" />
                    </div>

                    <div
                      className="mt-8 pt-6 border-t flex flex-wrap items-center gap-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <Button onClick={toggleUnderstood} variant={section.understood ? "outline" : "primary"}>
                        {section.understood ? "✓ Understood" : "Mark understood"}
                        {!section.understood && active < handout.sections.length - 1 && " → next"}
                      </Button>
                      {section.cards.length > 0 && (
                        <Link href={`/practice?handout=${handout.id}&section=${section.id}`}>
                          <Button variant="ghost">
                            Recall {section.cards.length} card
                            {section.cards.length === 1 ? "" : "s"} →
                          </Button>
                        </Link>
                      )}
                      {section.questions.length > 0 && (
                        <Link href={`/exam?handout=${handout.id}&section=${section.id}`}>
                          <Button variant="ghost">
                            Answer {section.questions.length} exam question
                            {section.questions.length === 1 ? "" : "s"} →
                          </Button>
                        </Link>
                      )}
                    </div>
                  </>
                ) : section.status === "error" ? (
                  <div className="rounded-xl border p-5" style={{ borderColor: "var(--line)" }}>
                    <p className="text-sm mb-3" style={{ color: "var(--warn)" }}>
                      This section didn&apos;t digest. The other sections are unaffected.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        retrySection(handout.id, active, course?.code ?? "").then(refresh)
                      }
                    >
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm pulsing" style={{ color: "var(--ink-faint)" }}>
                      {section.status === "running"
                        ? "Breaking this section down…"
                        : "Queued — earlier sections first."}
                    </p>
                    {[90, 100, 75, 95, 60].map((w, i) => (
                      <div
                        key={i}
                        className="h-3.5 rounded pulsing"
                        style={{ width: `${w}%`, background: "var(--line)" }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* ── Ask: docked on wide screens ──────────────────────── */}
        <aside
          className="hidden xl:flex w-88 shrink-0 border-l flex-col"
          style={{ borderColor: "var(--line)", background: "var(--card)" }}
        >
          <AskPanel
            handout={handout}
            section={section}
            selection={selection}
            onClearSelection={() => setSelection("")}
          />
        </aside>
      </div>

      {/* ── Ask: bottom sheet everywhere narrower than xl ──────── */}
      {section && (
        <>
          {!askOpen && (
            <button
              onClick={() => setAskOpen(true)}
              className="xl:hidden fixed bottom-5 right-5 z-40 rounded-full shadow-lg px-4 py-3 text-sm font-medium text-white flex items-center gap-2"
              style={{ background: "var(--accent)" }}
            >
              {selection ? "Ask about this" : "Ask"}
              {selection && <span className="w-1.5 h-1.5 rounded-full bg-white/80" />}
            </button>
          )}

          {askOpen && (
            <div className="xl:hidden fixed inset-0 z-40 flex flex-col justify-end">
              <div
                className="absolute inset-0"
                style={{ background: "rgba(0,0,0,.35)" }}
                onClick={() => setAskOpen(false)}
              />
              <div
                className="relative rounded-t-2xl border-t flex flex-col rise"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--line)",
                  height: "min(78vh, 40rem)",
                }}
              >
                <button
                  onClick={() => setAskOpen(false)}
                  className="absolute right-3 top-3 z-10 rounded-lg px-2 py-1 text-sm"
                  style={{ color: "var(--ink-faint)" }}
                  aria-label="Close ask panel"
                >
                  <Icon name="close" size={15} />
                </button>
                <AskPanel
                  handout={handout}
                  section={section}
                  selection={selection}
                  onClearSelection={() => setSelection("")}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Term definition popover */}
      {term && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(0,0,0,.35)" }}
          onClick={() => setTerm(null)}
        >
          <div
            className="max-w-md w-full rounded-xl border p-5 rise"
            style={{ background: "var(--card)", borderColor: "var(--line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2">{term.term}</h3>
            <p className="text-[14px] leading-relaxed mb-4" style={{ color: "var(--ink-soft)" }}>
              {term.definition}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelection(term.term);
                  setTerm(null);
                  setAskOpen(true); // no-op on xl, where the panel is already docked
                }}
              >
                Ask more about this
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTerm(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Disclosure({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "warn";
}) {
  const [open, setOpen] = useState(false);
  if (!body) return null;
  const color = tone === "warn" ? "var(--warn)" : "var(--ink-soft)";

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--line)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-(--accent-soft) transition-colors"
      >
        <span
          className="text-[11px] transition-transform inline-block"
          style={{ transform: open ? "rotate(90deg)" : "none", color }}
        >
          ▸
        </span>
        <span className="text-[13px] font-medium" style={{ color }}>
          {title}
        </span>
      </button>
      {open && (
        <div
          className="px-3.5 pb-3.5 pt-0.5 rise"
          style={{ background: tone === "warn" ? "var(--warn-soft)" : "transparent" }}
        >
          <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--ink)" }}>
            {body}
          </p>
        </div>
      )}
    </div>
  );
}
