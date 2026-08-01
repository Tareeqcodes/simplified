"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className = "",
  type = "button",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";
  const sizes = size === "sm" ? "text-[13px] px-2.5 py-1.5" : "text-sm px-3.5 py-2";
  const variants = {
    primary: "text-white hover:brightness-110 active:brightness-95",
    ghost: "hover:bg-[var(--accent-soft)]",
    outline: "border hover:bg-[var(--accent-soft)]",
    danger: "border hover:bg-[var(--warn-soft)]",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants} ${className}`}
      style={{
        background: variant === "primary" ? "var(--accent)" : undefined,
        color:
          variant === "primary"
            ? "#fff"
            : variant === "danger"
              ? "var(--warn)"
              : "var(--ink)",
        outlineColor: "var(--accent)",
      }}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ background: "var(--card)", borderColor: "var(--line)" }}
    >
      {children}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 rounded-full overflow-hidden"
        style={{ background: "var(--line)" }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Readiness"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
      <span
        className="text-xs tabular-nums font-medium w-14 text-right"
        style={{ color: "var(--ink-soft)" }}
      >
        {pct}% ready
      </span>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "warn";
}) {
  const styles = {
    neutral: { background: "var(--line)", color: "var(--ink-soft)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent)" },
    warn: { background: "var(--warn-soft)", color: "var(--warn)" },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={styles}
    >
      {children}
    </span>
  );
}

/**
 * Line icons at a single weight, sized to the type. Text glyphs like ← and ☾
 * render differently on every platform and never quite align with the label
 * beside them; these do.
 */
export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: "back" | "sun" | "moon" | "menu" | "upload" | "plus" | "close" | "share" | "trash";
  size?: number;
  className?: string;
}) {
  const paths: Record<string, React.ReactNode> = {
    back: <path d="M12.5 15L7.5 10l5-5" />,
    trash: (
      <>
        <path d="M4 6h12" />
        <path d="M8 6V4.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
        <path d="M6.2 6l.7 9.1a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9L13.8 6" />
        <path d="M8.6 9v4.2M11.4 9v4.2" />
      </>
    ),
    menu: (
      <>
        <path d="M3 5.5h14" />
        <path d="M3 10h14" />
        <path d="M3 14.5h14" />
      </>
    ),
    sun: (
      <>
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6L4 16M16 16l-1.4-1.4M5.4 5.4L4 4" />
      </>
    ),
    moon: <path d="M16.5 11.7A7 7 0 0 1 8.3 3.5a7 7 0 1 0 8.2 8.2z" />,
    upload: (
      <>
        <path d="M10 13V3.5" />
        <path d="M6 7.5L10 3.5l4 4" />
        <path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
      </>
    ),
    plus: <path d="M10 4.5v11M4.5 10h11" />,
    close: <path d="M5 5l10 10M15 5L5 15" />,
    share: (
      <>
        <circle cx="15" cy="5" r="2.2" />
        <circle cx="5" cy="10" r="2.2" />
        <circle cx="15" cy="15" r="2.2" />
        <path d="M7 8.9l6-2.8M7 11.1l6 2.8" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Square, icon-only control. Used for back, menu and theme in the header. */
export function IconButton({
  icon,
  onClick,
  label,
  href,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  onClick?: () => void;
  label: string;
  href?: string;
}) {
  const cls =
    "grid place-items-center w-9 h-9 rounded-full border transition-all hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] active:scale-95 shrink-0";
  const style = { color: "var(--ink-soft)", borderColor: "var(--line)" };

  if (href) {
    return (
      <Link href={href} className={cls} style={style} aria-label={label} title={label}>
        <Icon name={icon} />
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls} style={style} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  return (
    <IconButton
      icon={dark ? "sun" : "moon"}
      label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("theme", next ? "dark" : "light");
      }}
    />
  );
}

export function Header({
  title,
  subtitle,
  back,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ background: "color-mix(in srgb, var(--paper) 82%, transparent)" }}
    >
      <div className="mx-auto max-w-350 px-3 sm:px-5 h-16 flex items-center gap-3">
        {back && <IconButton icon="back" href={back.href} label={back.label} />}

        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[15px] font-semibold truncate tracking-[-0.015em]">{title}</div>
          {subtitle && (
            <div className="text-[12px] truncate mt-0.5" style={{ color: "var(--ink-faint)" }}>
              {subtitle}
            </div>
          )}
        </div>

        {/* Page actions sit beside the persistent theme control. */}
        <div className="flex items-center gap-2">
          {children && <div className="flex items-center gap-2">{children}</div>}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-16 px-6 rise">
      <h2 className="text-base font-semibold mb-1.5">{title}</h2>
      <p
        className="text-sm max-w-sm mx-auto mb-5 leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {body}
      </p>
      {action}
    </div>
  );
}

/**
 * In-app confirmation for destructive actions, replacing the browser's native
 * confirm(). It matches the rest of the app, reads cleanly on mobile, closes on
 * Escape or a backdrop tap, and focuses Cancel first so nothing is deleted by a
 * stray keypress.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const btnBase =
    "inline-flex items-center justify-center rounded-lg text-sm font-medium px-3.5 py-2 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[.98]";

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4 fade"
      style={{ background: "rgba(0,0,0,.4)" }}
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="max-w-sm w-full rounded-2xl border p-5 rise"
        style={{ background: "var(--card)", borderColor: "var(--line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3.5">
          <div
            className="grid place-items-center w-10 h-10 rounded-full shrink-0"
            style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
            aria-hidden="true"
          >
            <Icon name="trash" size={18} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="confirm-title" className="text-[15px] font-semibold mb-1">
              {title}
            </h2>
            <p
              id="confirm-message"
              className="text-[13px] leading-relaxed"
              style={{ color: "var(--ink-soft)" }}
            >
              {message}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className={`${btnBase} border hover:bg-[var(--accent-soft)]`}
            style={{ borderColor: "var(--line)", color: "var(--ink)", outlineColor: "var(--accent)" }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`${btnBase} text-white hover:brightness-110`}
            style={{ background: "var(--warn)", outlineColor: "var(--warn)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
