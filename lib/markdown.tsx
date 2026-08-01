"use client";

import React from "react";
import type { Term } from "./types";

/**
 * A deliberately small Markdown subset — headings, lists, bold/italic/code and
 * paragraphs — plus the one thing an off-the-shelf renderer can't do for us:
 * turning key terms into tappable definitions inline.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderTerms(
  text: string,
  terms: Term[],
  onTerm: (t: Term) => void,
  keyBase: string,
): React.ReactNode[] {
  if (!terms.length) return [text];

  // Longest first so "marketing margin" wins over "margin".
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const escaped = sorted.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text))) {
    const term = sorted.find((t) => t.term.toLowerCase() === m![1].toLowerCase());
    if (!term) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <button
        key={`${keyBase}-t${i++}`}
        onClick={() => onTerm(term)}
        className="underline decoration-dotted underline-offset-4 hover:bg-(--accent-soft) rounded-sm transition-colors"
        style={{ textDecorationColor: "var(--accent)" }}
        title="What does this mean?"
      >
        {m[1]}
      </button>,
    );
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(
  text: string,
  terms: Term[],
  onTerm: (t: Term) => void,
  keyBase: string,
): React.ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const k = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={k}>{part.slice(1, -1)}</em>;
    return <React.Fragment key={k}>{renderTerms(part, terms, onTerm, k)}</React.Fragment>;
  });
}

export function Markdown({
  text,
  terms = [],
  onTerm = () => {},
  className = "prose-read",
}: {
  text: string;
  terms?: Term[];
  onTerm?: (t: Term) => void;
  className?: string;
}) {
  const blocks: React.ReactNode[] = [];
  const lines = (text ?? "").replace(/\r/g, "").split("\n");

  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{inline(para.join(" "), terms, onTerm, key)}</p>);
    para = [];
  };

  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((it, i) => (
      <li key={`${key}-${i}`}>{inline(it, terms, onTerm, `${key}-${i}`)}</li>
    ));
    blocks.push(
      list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const key = `h${blocks.length}`;
      const Tag = (heading[1].length === 2 ? "h2" : "h3") as "h2" | "h3";
      blocks.push(<Tag key={key}>{inline(heading[2], terms, onTerm, key)}</Tag>);
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();

  return <div className={className}>{blocks}</div>;
}
