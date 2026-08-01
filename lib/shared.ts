"use client";

import { DIGESTS_BUCKET, digestFileId, downloadUrl, ensureSession, sharingConfigured, storage } from "./appwrite";
import type { Handout, Section } from "./types";

/**
 * The shared digest library.
 *
 * A digest is stored as one JSON file keyed by the handout's content hash, so
 * "has anyone already processed this?" is a single file fetch — no query engine,
 * no database. Forty classmates studying the same five handouts costs five
 * digestions instead of two hundred, and the app gets cheaper the more people
 * use it rather than more expensive.
 */

export interface SharedDigest {
  version: 1;
  title: string;
  courseCode: string;
  pageCount: number;
  isScanned: boolean;
  /**
   * Full content fingerprint of the source PDF. Lets someone who adopts this
   * from the library still dedupe if they later upload the actual file, and
   * lets them re-share the copy. Optional: older shared files predate it.
   */
  contentHash?: string;
  /** Sections minus the per-user bits — no progress, no local ids. */
  sections: Section[];
  publishedAt: number;
}

/** Encoded into the filename so the course library can find it by search. */
function fileName(courseCode: string, title: string) {
  return `${courseCode || "GENERAL"} · ${title}`.slice(0, 120);
}

/** Strip anything personal before a digest leaves this device. */
function shareable(sections: Section[]): Section[] {
  return sections
    .filter((s) => s.status === "done")
    .map((s) => ({ ...s, understood: false }));
}

/** Look for an existing digest of this exact document. */
export async function findShared(contentHash?: string): Promise<SharedDigest | null> {
  if (!sharingConfigured || !contentHash) return null;
  try {
    await ensureSession();
    const res = await fetch(downloadUrl(digestFileId(contentHash)), {
      credentials: "include",
    });
    if (!res.ok) return null;
    const digest = (await res.json()) as SharedDigest;
    return digest?.version === 1 && digest.sections?.length ? digest : null;
  } catch {
    // Offline, not shared yet, or no permission — fall through to digesting.
    return null;
  }
}

/** Publish a finished digest so classmates can adopt it instead of re-paying. */
export async function publishShared(
  handout: Handout,
  courseCode: string,
): Promise<{ ok: boolean; message: string }> {
  if (!sharingConfigured) {
    return { ok: false, message: "Sharing isn't configured on this build." };
  }
  if (!handout.contentHash) {
    return { ok: false, message: "This handout has no content fingerprint to share under." };
  }

  const sections = shareable(handout.sections);
  if (!sections.length) {
    return { ok: false, message: "Nothing to share yet — let it finish digesting." };
  }

  const userId = await ensureSession();
  if (!userId) return { ok: false, message: "Couldn't sign in to share." };

  const payload: SharedDigest = {
    version: 1,
    title: handout.title,
    courseCode,
    pageCount: handout.pageCount,
    isScanned: Boolean(handout.isScanned),
    contentHash: handout.contentHash,
    sections,
    publishedAt: Date.now(),
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const file = new File([blob], fileName(courseCode, handout.title), {
    type: "application/json",
  });

  const fileId = digestFileId(handout.contentHash);

  try {
    await storage().createFile(DIGESTS_BUCKET, fileId, file);
    return { ok: true, message: "Shared with your course." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!/already exists/i.test(msg)) {
      return { ok: false, message: msg || "Could not share this handout." };
    }
  }

  // Already published. Storage has no in-place update, so replace it — which
  // only succeeds if this device published it. If a classmate did, theirs
  // stands and there is nothing to do: the handout is already shared either way.
  try {
    await storage().deleteFile(DIGESTS_BUCKET, fileId);
  } catch {
    return { ok: true, message: "A classmate has already shared this one." };
  }

  try {
    await storage().createFile(DIGESTS_BUCKET, fileId, file);
    return { ok: true, message: "Updated the shared copy." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not update the shared copy.",
    };
  }
}

/** Is this handout already in the shared library? Drives the button's label. */
export async function isShared(contentHash?: string): Promise<boolean> {
  if (!sharingConfigured || !contentHash) return false;
  try {
    await ensureSession();
    await storage().getFile(DIGESTS_BUCKET, digestFileId(contentHash));
    return true;
  } catch {
    return false;
  }
}

export interface LibraryEntry {
  fileId: string;
  name: string;
  publishedAt: number;
  sizeBytes: number;
}

/** Browse what classmates have already digested, optionally by course code. */
export async function browseShared(courseCode?: string): Promise<LibraryEntry[]> {
  if (!sharingConfigured) return [];
  try {
    await ensureSession();
    const res = await storage().listFiles(DIGESTS_BUCKET, undefined, courseCode || undefined);
    return res.files.map((f) => ({
      fileId: f.$id,
      name: f.name,
      publishedAt: new Date(f.$createdAt).getTime(),
      sizeBytes: f.sizeOriginal,
    }));
  } catch (err) {
    console.warn("Could not list the shared library.", err);
    return [];
  }
}

/** Fetch one library entry by its file id (used when adopting from the list). */
export async function fetchSharedById(fileId: string): Promise<SharedDigest | null> {
  if (!sharingConfigured) return null;
  try {
    await ensureSession();
    const res = await fetch(downloadUrl(fileId), { credentials: "include" });
    if (!res.ok) return null;
    const digest = (await res.json()) as SharedDigest;
    return digest?.version === 1 ? digest : null;
  } catch {
    return null;
  }
}
