"use client";

import { useEffect, useRef, useState } from "react";
import { digestHandout, type Progress } from "@/lib/digest";
import { checkQuota, LIMITS } from "@/lib/quota";
import type { Course } from "@/lib/types";
import { Button, Card, Icon } from "./ui";

export function Uploader({
  courses,
  defaultCourseId,
  onDone,
}: {
  courses: Course[];
  defaultCourseId?: string;
  onDone: () => void;
}) {
  const [courseId, setCourseId] = useState(defaultCourseId ?? courses[0]?.id ?? "");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null && progress.phase !== "done";

  useEffect(() => {
    if (!busy) checkQuota("handout").then((q) => setRemaining(q.remaining));
  }, [busy]);

  async function handle(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("That isn't a PDF. Handouts need to be PDF files.");
      return;
    }
    const course = courses.find((c) => c.id === courseId);
    if (!course) {
      setError("Pick a course first.");
      return;
    }
    setError(null);
    try {
      await digestHandout(file, course.id, course.code, setProgress, () => onDone());
      setProgress(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Digestion failed.");
      setProgress(null);
    }
  }

  if (busy && progress) {
    const pct =
      progress.phase === "digesting" && progress.total
        ? Math.round((progress.done / progress.total) * 100)
        : progress.phase === "uploading"
          ? 5
          : 15;

    return (
      <Card className="p-5 rise">
        <div className="flex items-center gap-2.5 mb-3">
          <span
            className="pulsing w-2 h-2 rounded-full shrink-0"
            style={{ background: "var(--accent)" }}
          />
          <span className="text-[13.5px] font-medium">{progress.label}</span>
        </div>
        <div
          className="h-1 rounded-full overflow-hidden mb-2.5"
          style={{ background: "var(--line)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: "var(--accent)" }}
          />
        </div>
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          {progress.phase === "digesting"
            ? `${progress.done} of ${progress.total} sections done. Keep this tab open  closing it pauses the rest, though you can resume from the dashboard.`
            : "This takes a minute. Scanned handouts take a little longer."}
        </p>
      </Card>
    );
  }

  return (
    <div className="rise">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className="group rounded-2xl border border-dashed px-6 py-11 text-center cursor-pointer transition-all duration-200"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--line)",
          background: dragging ? "var(--accent-soft)" : "var(--card)",
        }}
      >
        <div
          className="mx-auto mb-3 grid place-items-center w-11 h-11 rounded-full transition-transform duration-200 group-hover:-translate-y-0.5"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <Icon name="upload" size={19} />
        </div>

        <p className="text-[14px] font-medium mb-1 tracking-[-0.01em]">
          {dragging ? "Drop it here" : "Drop a handout, or click to browse"}
        </p>
        

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => handle(e.target.files?.[0])}
        />
      </div>

      {/* Destination and remaining allowance sit under the target, not above it,
          so the eye lands on the drop zone first. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
            Add to
          </span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="text-[11.5px] rounded-md border px-1.5 py-1 cursor-pointer max-w-45 truncate"
            style={{
              background: "transparent",
              borderColor: "var(--line)",
              color: "var(--ink-soft)",
            }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>

        {/* {remaining !== null && (
          <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
            {remaining === 0
              ? "Daily limit reached · repeats still free"
              : `${remaining} of ${LIMITS.handoutsPerDay} left today · repeats free`}
          </span>
        )} */}
      </div>

      {error && (
        <p className="text-[12px] mt-2 px-1" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function AddCourse({ onAdd }: { onAdd: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        Add course
      </Button>
    );
  }

  const field = {
    background: "var(--card)",
    borderColor: "var(--line)",
    color: "var(--ink)",
  };

  return (
    <Card className="p-4 w-full rise">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          onAdd(code.trim().toUpperCase());
          setCode("");
          setOpen(false);
        }}
        className="flex flex-wrap gap-2 items-end"
      >
        <div className="flex-1 min-w-40">
          <label className="block text-[11px] mb-1" style={{ color: "var(--ink-soft)" }}>
            Course code
          </label>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="EPP 401"
            className="text-sm rounded-lg border px-2.5 py-1.5 w-full"
            style={field}
          />
        </div>
        <Button type="submit" size="sm">
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </form>
    </Card>
  );
}
