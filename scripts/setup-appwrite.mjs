/**
 * Provisions the Appwrite backing store. Idempotent — safe to re-run.
 *
 *   node scripts/setup-appwrite.mjs
 *
 * Needs APPWRITE_API_KEY (server key, `databases` scope) in .env.local.
 * Collections can't be created from the browser SDK, which is why this exists
 * as a script rather than app code.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const ENDPOINT = process.env.APPWRITE_ENDPOINT;
const PROJECT = process.env.APPWRITE_PROJECT;
const KEY = process.env.APPWRITE_API_KEY;

if (!ENDPOINT || !PROJECT || !KEY) {
  console.error("Missing APPWRITE_ENDPOINT, APPWRITE_PROJECT or APPWRITE_API_KEY in .env.local");
  process.exit(1);
}

// Use the database you created; the free plan allows only one.
export const DB_ID = process.env.APPWRITE_DB || "simplified";
export const DIGESTS = "digests";
export const USAGE = "usage";

async function api(path, method = "GET", body) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": PROJECT,
      "X-Appwrite-Key": KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

/** Treats "already exists" as success so the script can be re-run freely. */
async function ensure(label, path, body) {
  const r = await api(path, "POST", body);
  if (r.ok) return console.log(`  created  ${label}`);
  if (r.status === 409) return console.log(`  exists   ${label}`);
  console.error(`  FAILED   ${label}: ${r.data?.message ?? r.status}`);
  process.exitCode = 1;
}

const string = (col, key, size, required = false, array = false) =>
  ensure(`${col}.${key}`, `/databases/${DB_ID}/collections/${col}/attributes/string`, {
    key,
    size,
    required,
    array,
  });

const integer = (col, key, required = false) =>
  ensure(`${col}.${key}`, `/databases/${DB_ID}/collections/${col}/attributes/integer`, {
    key,
    required,
  });

const boolean = (col, key, required = false) =>
  ensure(`${col}.${key}`, `/databases/${DB_ID}/collections/${col}/attributes/boolean`, {
    key,
    required,
  });

const index = (col, key, type, attributes) =>
  ensure(`${col}#${key}`, `/databases/${DB_ID}/collections/${col}/indexes`, {
    key,
    type,
    attributes,
  });

console.log(`\nUsing database: ${DB_ID}`);
const check = await api(`/databases/${DB_ID}`);
if (!check.ok) {
  console.error(`  cannot reach database ${DB_ID}: ${check.data?.message ?? check.status}`);
  process.exit(1);
}
console.log(`  ok — "${check.data.name}"`);

// Shared digests live in Storage, not here: the free plan allows one database,
// and a hash-keyed JSON file is a better fit than a document collection anyway.

console.log("\nCollection: usage (server-enforced quota)");
await ensure("collection", `/databases/${DB_ID}/collections`, {
  collectionId: USAGE,
  name: "Daily usage",
  // No user-facing permissions at all: only the server key touches this, so a
  // student can't reset their own counter from the browser.
  permissions: [],
  documentSecurity: false,
});
await string(USAGE, "userId", 64, true);
await string(USAGE, "day", 16, true);
await integer(USAGE, "handouts");
await integer(USAGE, "questions");

// Attributes must finish provisioning before indexes can reference them.
console.log("\nWaiting for attributes to become available…");
for (let i = 0; i < 30; i++) {
  const u = await api(`/databases/${DB_ID}/collections/${USAGE}/attributes`);
  const all = u.data.attributes ?? [];
  const pending = all.filter((a) => a.status !== "available");
  if (all.length && pending.length === 0) {
    console.log(`  all ${all.length} attributes available`);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

console.log("\nIndexes");
await index(USAGE, "byUserDay", "key", ["userId", "day"]);

console.log(
  process.exitCode ? "\nFinished with errors — see above.\n" : "\nAppwrite is ready.\n",
);
