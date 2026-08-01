"use client";

import { Account, Client, Storage } from "appwrite";

export const DIGESTS_BUCKET = "digests";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT;

/** False when the app is running without a backend — everything stays local. */
export const sharingConfigured = Boolean(endpoint && project);

let client: Client | null = null;

function appwrite() {
  if (!client) {
    if (!sharingConfigured) throw new Error("Appwrite is not configured.");
    client = new Client().setEndpoint(endpoint!).setProject(project!);
  }
  return client;
}

let sessionPromise: Promise<string | null> | null = null;

/**
 * Anonymous sign-in — one tap, no email, no password. Non-technical classmates
 * won't create accounts, and the only thing we need an identity for is quota
 * and attributing a shared digest to whoever published it.
 *
 * Caveat worth knowing: the session lives in browser storage, so clearing site
 * data produces a new identity with a fresh quota. Acceptable for now; the fix
 * is an optional email upgrade, which this returns an id for either way.
 */
export async function ensureSession(): Promise<string | null> {
  if (!sharingConfigured) return null;
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const account = new Account(appwrite());
      try {
        const me = await account.get();
        return me.$id;
      } catch {
        try {
          const session = await account.createAnonymousSession();
          return session.userId;
        } catch (err) {
          console.warn("Anonymous sign-in failed; sharing disabled.", err);
          return null;
        }
      }
    })();
  }
  return sessionPromise;
}

/**
 * A short-lived token proving who this browser is signed in as.
 *
 * The Appwrite session cookie is scoped to Appwrite's own domain, so the
 * browser never sends it to our API routes. A JWT is the supported way to
 * carry that identity across to our own server.
 */
export async function getJwt(): Promise<string | null> {
  if (!sharingConfigured) return null;
  try {
    await ensureSession();
    const { jwt } = await new Account(appwrite()).createJWT();
    return jwt;
  } catch {
    return null;
  }
}

export function storage() {
  return new Storage(appwrite());
}

/**
 * Appwrite file ids allow at most 36 characters and can't start with a special
 * character, so a 64-char SHA-256 hex digest has to be truncated. 124 bits of
 * the digest is far more than enough to make a collision impossible in a class
 * library — and a collision would only mean one wrong cache hit, not data loss.
 */
export function digestFileId(contentHash: string): string {
  return `d${contentHash.slice(0, 31)}`;
}

export function downloadUrl(fileId: string): string {
  return `${endpoint}/storage/buckets/${DIGESTS_BUCKET}/files/${fileId}/download?project=${project}`;
}
