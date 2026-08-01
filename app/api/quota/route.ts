import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/limits";

/**
 * Server-enforced daily quota.
 *
 * The browser-side check in lib/quota.ts is for showing "3 of 5 left" — it is
 * trivially bypassed with devtools. This route is the one that actually counts,
 * because the `usage` collection has no user-facing permissions at all: only
 * the server key can read or write it.
 *
 * The caller proves who they are with their Appwrite session, which we verify
 * against /account before touching any counter.
 */

const ENDPOINT = process.env.APPWRITE_ENDPOINT;
const PROJECT = process.env.APPWRITE_PROJECT;
const API_KEY = process.env.APPWRITE_API_KEY;
const DB = process.env.APPWRITE_DB;
const USAGE = "usage";

// Route files may only export handlers and config, so this stays module-local.
// Values come from the shared source so the browser and server never disagree.
const DAILY = { handout: LIMITS.handoutsPerDay, question: LIMITS.questionsPerDay } as const;
type Kind = keyof typeof DAILY;

const configured = Boolean(ENDPOINT && PROJECT && API_KEY && DB);

function dayKey(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

async function admin(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": PROJECT!,
      "X-Appwrite-Key": API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}

/**
 * Resolve the caller's user id from their Appwrite JWT — never from the body,
 * which the caller controls. A cookie can't be used here: Appwrite's session
 * cookie is scoped to Appwrite's domain and is never sent to this origin.
 */
async function whoAmI(req: Request): Promise<string | null> {
  const jwt = req.headers.get("x-appwrite-jwt");
  if (!jwt) return null;
  const res = await fetch(`${ENDPOINT}/account`, {
    headers: { "X-Appwrite-Project": PROJECT!, "X-Appwrite-JWT": jwt },
  });
  if (!res.ok) return null;
  const me = (await res.json()) as { $id?: string };
  return me.$id ?? null;
}

async function readRow(userId: string, day: string) {
  const q = [
    JSON.stringify({ method: "equal", attribute: "userId", values: [userId] }),
    JSON.stringify({ method: "equal", attribute: "day", values: [day] }),
    JSON.stringify({ method: "limit", values: [1] }),
  ]
    .map((s) => `queries[]=${encodeURIComponent(s)}`)
    .join("&");

  const r = await admin(`/databases/${DB}/collections/${USAGE}/documents?${q}`);
  const doc = r.data?.documents?.[0];
  return doc as
    | { $id: string; handouts: number; questions: number }
    | undefined;
}

export async function POST(req: Request) {
  // Without a backend the client-side limits are all there is; don't block.
  if (!configured) {
    return NextResponse.json({ allowed: true, unenforced: true });
  }

  const { kind, commit } = (await req.json().catch(() => ({}))) as {
    kind?: Kind;
    commit?: boolean;
  };
  if (kind !== "handout" && kind !== "question") {
    return NextResponse.json({ error: "Unknown quota kind." }, { status: 400 });
  }

  const userId = await whoAmI(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const day = dayKey();
  const limit = DAILY[kind];

  try {
    const row = await readRow(userId, day);
    const used = row ? (kind === "handout" ? row.handouts : row.questions) : 0;

    if (used >= limit) {
      return NextResponse.json({
        allowed: false,
        used,
        limit,
        remaining: 0,
        message:
          kind === "handout"
            ? `You've digested ${limit} handouts today. It resets at midnight — handouts already shared by classmates are still free.`
            : `You've used ${limit} questions today. It resets at midnight.`,
      });
    }

    if (commit) {
      const next = {
        userId,
        day,
        handouts: (row?.handouts ?? 0) + (kind === "handout" ? 1 : 0),
        questions: (row?.questions ?? 0) + (kind === "question" ? 1 : 0),
      };
      if (row) {
        await admin(`/databases/${DB}/collections/${USAGE}/documents/${row.$id}`, "PATCH", {
          data: next,
        });
      } else {
        await admin(`/databases/${DB}/collections/${USAGE}/documents`, "POST", {
          documentId: "unique()",
          data: next,
        });
      }
    }

    return NextResponse.json({
      allowed: true,
      used: commit ? used + 1 : used,
      limit,
      remaining: Math.max(0, limit - (commit ? used + 1 : used)),
    });
  } catch (err) {
    // A quota backend failure must not lock students out of studying.
    console.error("Quota check failed; allowing through.", err);
    return NextResponse.json({ allowed: true, degraded: true });
  }
}
