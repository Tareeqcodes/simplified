"use client";

import { ensureSession, getJwt } from "./appwrite";
import { getUsage, saveUsage } from "./db";
import { LIMITS } from "./limits";

/**
 * NOTE: this module counts quota in the browser, which is bypassable by anyone
 * who opens devtools. That is only the display copy; the authoritative count is
 * the server enforcer in app/api/quota, consulted via checkQuotaServer. The
 * limit values themselves live in ./limits so both sides share one source.
 */
export { LIMITS } from "./limits";

export type QuotaKind = "handout" | "question";

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** When the window rolls over, epoch ms. */
  resetAt: number;
  message?: string;
}

/**
 * Quota day in UTC — the same boundary the server enforcer uses (app/api/quota
 * derives its day from toISOString). Matching it keeps the "N left today" the
 * browser shows in step with what the server actually allows, instead of the two
 * rolling over hours apart for anyone outside UTC.
 */
export function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

function nextMidnight(at = Date.now()): number {
  const d = new Date(at);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Ask the server, which counts against the signed-in user and can't be edited
 * from the browser. Falls back to the local counter when there's no backend or
 * the network is down — a student offline should still be able to study.
 */
export async function checkQuotaServer(
  kind: QuotaKind,
  commit = false,
): Promise<QuotaCheck | null> {
  try {
    const jwt = await getJwt();
    if (!jwt) return null; // no backend or not signed in — fall back to local
    const res = await fetch("/api/quota", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Appwrite-JWT": jwt },
      body: JSON.stringify({ kind, commit }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.unenforced || d.degraded) return null;
    return {
      allowed: Boolean(d.allowed),
      used: d.used ?? 0,
      limit: d.limit ?? (kind === "handout" ? LIMITS.handoutsPerDay : LIMITS.questionsPerDay),
      remaining: d.remaining ?? 0,
      resetAt: nextMidnight(),
      message: d.message,
    };
  } catch {
    return null;
  }
}

export async function checkQuota(kind: QuotaKind, at = Date.now()): Promise<QuotaCheck> {
  const limit = kind === "handout" ? LIMITS.handoutsPerDay : LIMITS.questionsPerDay;
  const usage = await getUsage(dayKey(at));
  const used = kind === "handout" ? usage.handouts : usage.questions;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
    resetAt: nextMidnight(at),
    message:
      used < limit
        ? undefined
        : kind === "handout"
          ? `You've digested ${limit} handouts today. The limit resets at midnight. Handouts already in your library are still free to open, and re-uploading one you've done before doesn't count.`
          : `You've used ${limit} questions today. The limit resets at midnight.`,
  };
}

export async function recordUsage(kind: QuotaKind, at = Date.now()): Promise<void> {
  const key = dayKey(at);
  const usage = await getUsage(key);
  await saveUsage({
    day: key,
    handouts: usage.handouts + (kind === "handout" ? 1 : 0),
    questions: usage.questions + (kind === "question" ? 1 : 0),
  });
}

/**
 * The single gate every paid action passes through: check it's allowed, count
 * it, or throw a human message the caller can show. The server's tally wins when
 * it's reachable — it's the copy a student can't edit from devtools — and the
 * browser counter is the offline fallback so studying still works on a train.
 *
 * Throws (rather than returning a flag) so a blocked action simply doesn't run.
 */
export async function enforceQuota(kind: QuotaKind): Promise<void> {
  await ensureSession();
  const server = await checkQuotaServer(kind, true);
  if (server) {
    if (!server.allowed) throw new Error(server.message ?? "You've reached today's limit.");
  } else {
    const local = await checkQuota(kind);
    if (!local.allowed) throw new Error(local.message ?? "You've reached today's limit.");
  }
  await recordUsage(kind);
}

/** Pre-flight checks that don't need the day counter. */
export function checkFile(file: File, pageCount?: number): string | null {
  if (file.size > LIMITS.fileSizeBytes) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${LIMITS.fileSizeBytes / 1024 / 1024}MB — try splitting it.`;
  }
  if (pageCount && pageCount > LIMITS.pagesPerHandout) {
    return `That's ${pageCount} pages. The limit is ${LIMITS.pagesPerHandout} per handout — upload it in parts.`;
  }
  return null;
}
