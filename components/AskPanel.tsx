"use client";

import { useEffect, useRef, useState } from "react";
import { getChat, saveChat, uid } from "@/lib/db";
import { enforceQuota } from "@/lib/quota";
import { Icon } from "@/components/ui";
import { Markdown } from "@/lib/markdown";
import { sourceFor } from "@/lib/digest";
import { BEYOND_MARKER, type ChatTurn, type Handout, type Section } from "@/lib/types";

const QUICK = [
  { label: "Explain simply", q: "Explain this in the simplest way you can." },
  { label: "Example", q: "Give me a concrete Nigerian example of this." },
  { label: "Why it matters", q: "Why does this matter — where is it actually used?" },
  { label: "Test me", q: "Ask me one exam-style question on this, then wait for my answer." },
];

function split(text: string) {
  const i = text.indexOf(BEYOND_MARKER);
  if (i === -1) return { grounded: text, beyond: "" };
  return {
    grounded: text.slice(0, i).trim(),
    beyond: text.slice(i + BEYOND_MARKER.length).trim(),
  };
}

function Answer({ text, streaming }: { text: string; streaming?: boolean }) {
  const { grounded, beyond } = split(text);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Markdown text={grounded} className="prose-read text-[14px] leading-[1.65]" />
      {streaming && (
        <span className="pulsing inline-block ml-0.5" style={{ color: "var(--accent)" }}>
          ▌
        </span>
      )}
      {beyond && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] font-medium flex items-center gap-1.5 hover:opacity-70 transition-opacity"
            style={{ color: "var(--warn)" }}
          >
            <span
              className="transition-transform inline-block"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
            >
              ▸
            </span>
            Beyond the handout
          </button>
          {open && (
            <div className="mt-2 rounded-lg p-3 rise" style={{ background: "var(--warn-soft)" }}>
              <p className="text-[11px] mb-1.5 font-medium" style={{ color: "var(--warn)" }}>
                Not from your lecturer — context only. Don&apos;t write this in an exam
                unless it was taught.
              </p>
              <Markdown text={beyond} className="prose-read text-[13.5px] leading-[1.6]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AskPanel({
  handout,
  section,
  selection,
  onClearSelection,
}: {
  handout: Handout;
  section: Section | undefined;
  selection: string;
  onClearSelection: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chatId = section ? `${handout.id}:${section.id}` : "";

  useEffect(() => {
    if (!chatId) return;
    getChat(chatId).then((c) => setTurns(c?.turns ?? []));
    setStreaming("");
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming]);

  async function ask(question: string) {
    if (!question.trim() || busy || !section) return;

    // Ask and grade share the daily question allowance. Check before we touch
    // the transcript, so a blocked question leaves no dangling turn behind.
    setError(null);
    try {
      await enforceQuota("question");
    } catch (e) {
      setError(e instanceof Error ? e.message : "You've reached today's question limit.");
      return;
    }

    const userTurn: ChatTurn = {
      id: uid(),
      role: "user",
      text: selection ? `${question}\n\n“${selection.slice(0, 160)}${selection.length > 160 ? "…" : ""}”` : question,
      createdAt: Date.now(),
    };
    const next = [...turns, userTurn];
    setTurns(next);
    setInput("");
    setBusy(true);
    setStreaming("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...sourceFor(handout, section.pageStart, section.pageEnd),
          question,
          selection,
          heading: section.heading,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          history: turns.map((t) => ({ role: t.role, text: t.text })),
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Could not get an answer.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreaming(acc);
      }

      const answer: ChatTurn = {
        id: uid(),
        role: "assistant",
        text: acc,
        createdAt: Date.now(),
      };
      const finalTurns = [...next, answer];
      setTurns(finalTurns);
      setStreaming("");
      await saveChat({ id: chatId, handoutId: handout.id, sectionId: section.id, turns: finalTurns });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStreaming("");
      } else {
        setTurns([
          ...next,
          {
            id: uid(),
            role: "assistant",
            text: `[${err instanceof Error ? err.message : "Something went wrong."}]`,
            createdAt: Date.now(),
          },
        ]);
        setStreaming("");
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      onClearSelection();
    }
  }

  if (!section) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
          Ask
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4 space-y-5">
        {turns.length === 0 && !streaming && (
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            Stuck on something? Highlight it in the text, or just ask. Answers come from
            <em> this handout</em> first, with anything extra kept separate.
          </p>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="rise">
              <div
                className="text-[13px] rounded-lg px-3 py-2 whitespace-pre-wrap"
                style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
              >
                {t.text}
              </div>
            </div>
          ) : (
            <div key={t.id} className="rise">
              <Answer text={t.text} />
            </div>
          ),
        )}

        {streaming && <Answer text={streaming} streaming />}
        <div ref={endRef} />
      </div>

      <div className="border-t px-4 py-3 shrink-0" style={{ borderColor: "var(--line)" }}>
        {selection && (
          <div
            className="mb-2 rounded-lg px-2.5 py-1.5 text-[11px] flex items-start gap-2"
            style={{ background: "var(--accent-soft)" }}
          >
            <span className="flex-1 line-clamp-2 italic" style={{ color: "var(--ink-soft)" }}>
              “{selection.slice(0, 120)}
              {selection.length > 120 ? "…" : ""}”
            </span>
            <button
              onClick={onClearSelection}
              className="shrink-0 rounded hover:opacity-70 transition-opacity"
              style={{ color: "var(--ink-faint)" }}
              title="Clear selection"
              aria-label="Clear selection"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-2">
          {QUICK.map((q) => (
            <button
              key={q.label}
              onClick={() => ask(q.q)}
              disabled={busy}
              className="text-[11px] rounded-full border px-2.5 py-1 hover:bg-[var(--accent-soft)] disabled:opacity-40 transition-colors"
              style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
            >
              {q.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-[12px] mb-2 leading-snug" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            disabled={busy}
            className="flex-1 text-[13px] rounded-lg border px-3 py-2 disabled:opacity-50"
            style={{ background: "var(--paper)", borderColor: "var(--line)", color: "var(--ink)" }}
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="text-[13px] rounded-lg border px-3"
              style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="text-[13px] rounded-lg px-3 text-white disabled:opacity-30"
              style={{ background: "var(--accent)" }}
            >
              →
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
