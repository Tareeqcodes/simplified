# Simplified

An exam-prep companion that happens to read your handouts.

You drop in a lecture handout — a PDF, PowerPoint, Word doc or text file. It gets
broken into study-sized sections, each rewritten in plain English, with key
terms, recall cards and practice questions generated from it. Reading is the
on-ramp — the app exists to get you ready for the exam.

## Setup

```bash
cp .env.example .env.local     # then fill it in
npm run dev                    # http://localhost:3000
```

The app talks to one model vendor at a time, chosen with `AI_PROVIDER`:

- `AI_PROVIDER=claude` — local development ([console.anthropic.com](https://console.anthropic.com/settings/keys))
- `AI_PROVIDER=gemini` — the public deployment, on the free tier ([aistudio.google.com](https://aistudio.google.com/apikey))

Set the matching key (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`). Nothing works
without one — the app says so on the dashboard rather than failing silently
mid-upload. Sharing and server-enforced quota are optional and need Appwrite;
without it everything still works, just locally on one machine.

## How it works

**Upload → digest → read → practice.**

1. The handout is read in the browser. PDFs are parsed with pdf.js; PowerPoint,
   Word and text files are parsed for their text (each slide becomes a "page", so
   citations still line up). Whatever the format, the words never leave your
   machine as a file — only the text each call needs is sent. The one exception
   is a scanned **PDF** with no text layer, which is uploaded once to the
   provider's file store so the model can read it. (Image-only slides or docs
   can't be read — the app asks you to export a PDF instead.)
2. An outline pass splits it into sections with page ranges.
3. Each section is digested into three reading depths of the same content, plus
   its study material.
4. Cards enter a spaced-repetition queue. What you keep missing surfaces on the
   dashboard as a weak spot.

Section 1 is digested alone before the rest run in parallel — it writes the
prompt cache for the PDF, so the remaining sections read it back at roughly a
tenth of the cost instead of each paying for a full pass over the document.

## The depth dial

Every section exists at three depths, and the dial swaps between them in place:

| Depth | What it is |
|---|---|
| **Gist** | The section in 3–5 bullets. For the night before. |
| **Simplified** | Plain-English rewrite. Nothing examinable dropped. The default. |
| **Original** | Verbatim transcription, typos included, page-referenced. |

## Exam mode

Cards test recall; exams test writing. Every section ships 2–4 questions with
mark allocations, a full-mark model answer, and the points an answer must make.
You write yours, it gets marked against those points, and you see which ones you
hit and which you missed.

The marker is told not to inflate — a student reading a generous grade walks in
unprepared, which is the one outcome this app exists to prevent. Questions you
score worst on come back first.

## Grounding

Answers are split in two. The first part comes from your handout and cites
pages. Anything beyond it is collapsed under **Beyond the handout** and marked
as not-from-your-lecturer, because writing textbook content your lecturer didn't
teach is how people lose marks.

Practice questions are generated from the handout's own emphasis. They are
practice, not predictions.

## If digestion stops early

Digestion runs in the tab that started it. Close that tab and the remaining
sections pause. The dashboard shows a **Resume** button on any handout with
unfinished sections and picks up exactly where it stopped.

## Storage

Everything lives in your browser (IndexedDB) — courses, handouts, progress,
chats, exam attempts. There is no database and no account. Clearing site data
clears the library, and there is no export yet, so treat it as one machine only.

A scanned PDF (no text layer) is uploaded to the model provider's file store so
it can be read; text handouts never leave your machine. Deleting a handout
deletes that uploaded copy too.

## Sharing

With Appwrite configured, a finished digest can be published to a course library
and adopted by a classmate straight from their dashboard — no re-upload, no
reprocessing. Uploading a handout someone already digested copies theirs instead
of paying to redo it, so a class of forty digests each handout once rather than
forty times. Without Appwrite this is simply absent and the app stays fully
local.

## Layout

```
app/
  page.tsx              dashboard — courses, readiness, what's due, resume
  handout/[id]/         the reader — depth dial, key terms, ask panel
  practice/             flashcards, spaced repetition
  exam/                 written answers, marked against the handout
  api/upload            scanned PDF → provider file store
  api/outline           document → sections
  api/section           section → three depths + cards + questions
  api/ask               streaming Q&A, grounded/beyond split
  api/grade             marks a written answer against mustMention
  api/quota             server-authoritative daily quota (Appwrite)
  api/file              releases an uploaded PDF from the provider's store
lib/
  providers/            one adapter per vendor (claude, gemini) behind AI_PROVIDER
  db.ts                 IndexedDB
  digest.ts             the read → outline → digest pipeline
  schedule.ts           spaced repetition + readiness scoring
  quota.ts, limits.ts   daily allowances — browser counter, shared limit values
  shared.ts, dedupe.ts  the shared course library and duplicate detection
  markdown.tsx          small renderer with inline key-term definitions
```

## Models and cost

One adapter per vendor, chosen by `AI_PROVIDER` — `claude` in development,
`gemini` on the public free tier. Model ids and per-job settings live in the
adapters ([`lib/providers/claude.ts`](lib/providers/claude.ts),
[`lib/providers/gemini.ts`](lib/providers/gemini.ts)) and every one is
overridable by env var.

Claude defaults — all `claude-sonnet-5`, with effort dialled per job:

| Job | Effort | Why |
|---|---|---|
| Section digest | `medium` | The biggest spend, and the rewrite you actually read |
| Outline | `medium` | Structural, once per handout |
| Ask | `low` | The only place you watch a cursor blink |

Every call also sends `thinking: adaptive`, which rules out Haiku 4.5 — it
supports neither that nor `effort` and 400s without code changes. Gemini uses
`gemini-2.5-flash` for every job.

Prompt caches are per model, so the outline's cache doesn't carry into
digestion. The pipeline already handles this — section 1 runs alone and writes
the cache the rest read back.
