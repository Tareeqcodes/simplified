"use client";

import { useEffect, useRef, useState } from "react";
import { adoptShared } from "@/lib/dedupe";
import { browseShared, fetchSharedById, type LibraryEntry } from "@/lib/shared";
import type { Course } from "@/lib/types";
import { Icon } from "./ui";

/** "3d ago", "2mo ago" — coarse is fine for a "when was this shared" line. */
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** The filename is stored as "CODE · Title"; show the title on its own. */
function titleOf(name: string): string {
  const i = name.indexOf(" · ");
  return i === -1 ? name : name.slice(i + 3);
}

/**
 * Browse digests classmates have already published for this course and copy one
 * into your own library — no upload, no processing, no quota. This is the payoff
 * of the shared library: five people digest a handout once, forty adopt it.
 */
export function SharedLibrary({
  course,
  onClose,
  onAdopted,
}: {
  course: Course;
  onClose: () => void;
  onAdopted: () => void;
}) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    browseShared(course.code)
      .then((e) => {
        if (!cancelled) setEntries(e.sort((a, b) => b.publishedAt - a.publishedAt));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [course.code]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function adopt(entry: LibraryEntry) {
    setAdopting(entry.fileId);
    setError(null);
    try {
      const digest = await fetchSharedById(entry.fileId);
      if (!digest) throw new Error("That digest couldn't be loaded — it may have been removed.");
      // Prefer the full hash carried in the payload; fall back to the truncated
      // one encoded in the file id for copies published before it was added.
      const contentHash = digest.contentHash ?? entry.fileId.replace(/^d/, "");
      await adoptShared(digest, course.id, digest.title, contentHash);
      setAdded((s) => new Set(s).add(entry.fileId));
      onAdopted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that handout.");
    } finally {
      setAdopting(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4 fade"
      style={{ background: "rgba(0,0,0,.4)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        className="w-full max-w-lg rounded-2xl border rise flex flex-col max-h-[80vh]"
        style={{ background: "var(--card)", borderColor: "var(--line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0">
            <h2 id="library-title" className="text-[15px] font-semibold">
              Shared handouts
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
              Already digested for {course.code} — add one free, no processing.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="grid place-items-center w-8 h-8 rounded-lg shrink-0 transition-colors hover:bg-[var(--accent-soft)]"
            style={{ color: "var(--ink-faint)" }}
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="overflow-y-auto scroll-thin px-2 py-2">
          {entries === null ? (
            <p className="pulsing text-[13px] px-3 py-6 text-center" style={{ color: "var(--ink-faint)" }}>
              Looking for shared handouts…
            </p>
          ) : entries.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13.5px] font-medium mb-1">Nothing shared yet</p>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                When you or a classmate digests a {course.code} handout and taps Share,
                it shows up here for everyone to adopt.
              </p>
            </div>
          ) : (
            <ul>
              {entries.map((entry) => {
                const isAdded = added.has(entry.fileId);
                const isAdopting = adopting === entry.fileId;
                return (
                  <li
                    key={entry.fileId}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--accent-soft)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] truncate">{titleOf(entry.name)}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
                        shared {ago(entry.publishedAt)} · {Math.max(1, Math.round(entry.sizeBytes / 1024))} KB
                      </p>
                    </div>
                    {isAdded ? (
                      <span
                        className="text-[12px] font-medium shrink-0 inline-flex items-center gap-1"
                        style={{ color: "var(--accent)" }}
                      >
                        Added ✓
                      </span>
                    ) : (
                      <button
                        onClick={() => adopt(entry)}
                        disabled={isAdopting}
                        className="text-[12.5px] font-medium rounded-lg border px-3 py-1.5 shrink-0 transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                        style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                      >
                        {isAdopting ? "Adding…" : "Add"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p className="text-[12px] px-3 py-2" style={{ color: "var(--warn)" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
