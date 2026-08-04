"use client";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Loaded on demand, never at module scope: pdf.js touches browser-only globals
 * (DOMMatrix and friends), so importing it eagerly breaks the prerender pass.
 */
/**
 * pdf.js 6 calls Promise.withResolvers, which Safari only shipped in 17.4.
 * Without this, extraction throws on every iPhone below that — and on iOS
 * every browser is Safari underneath, so it isn't a "Safari users" problem,
 * it's an "all iPhones" problem.
 */
function polyfillWithResolvers() {
  const P = Promise as unknown as {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (v: T | PromiseLike<T>) => void;
      reject: (r?: unknown) => void;
    };
  };
  if (typeof P.withResolvers === "function") return;
  P.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    polyfillWithResolvers();
    // The legacy build is pre-transpiled for older engines. The default build
    // uses syntax and APIs that Safari only gained recently, which made
    // extraction fail on every iPhone below iOS 17.4 while working in desktop
    // Chrome. The size difference is not worth losing those users over.
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      // Bundled worker — no CDN, so this keeps working offline and on any host.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** A page yielding less than this has no usable text layer — it's a scan. */
const MIN_CHARS_PER_PAGE = 50;

/** Below this share of readable pages we treat the whole document as scanned. */
const TEXT_PAGE_RATIO = 0.6;

export interface ExtractedPdf {
  pages: string[];
  pageCount: number;
  /** True when there is no usable text layer and the model must read images. */
  isScanned: boolean;
  /** SHA-256 of the raw bytes. Exact-duplicate detection. */
  fileHash: string;
  /** SHA-256 of the normalised text. Catches re-compressed copies of the same handout. */
  contentHash: string;
  /** Characters recovered, for reporting. */
  charCount: number;
}

export async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Strip everything that changes between copies of the same handout — casing,
 * whitespace, punctuation, page numbering — so a WhatsApp-recompressed copy
 * fingerprints identically to the lecturer's original.
 */
export function normaliseForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[\[page \d+\]\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d{1,3}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractPdf(file: File): Promise<ExtractedPdf> {
  const pdfjs = await loadPdfJs();
  const bytes = await file.arrayBuffer();
  const fileHash = await sha256(bytes);

  // pdf.js takes ownership of the buffer it reads, so hand it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
    page.cleanup();
  }
  await doc.cleanup();

  const readable = pages.filter((p) => p.length >= MIN_CHARS_PER_PAGE).length;
  const isScanned = doc.numPages === 0 || readable / doc.numPages < TEXT_PAGE_RATIO;
  const charCount = pages.reduce((n, p) => n + p.length, 0);

  const normalised = normaliseForHash(pages.join(" "));
  const contentHash = normalised.length > 200 ? await sha256(normalised) : fileHash;

  return { pages, pageCount: doc.numPages, isScanned, fileHash, contentHash, charCount };
}

/**
 * The text for a page range, marked up so the model can cite real page numbers.
 * `pageStart`/`pageEnd` are 1-based and inclusive.
 */
export function pageRangeText(pages: string[], pageStart: number, pageEnd: number): string {
  const from = Math.max(1, pageStart);
  const to = Math.min(pages.length, pageEnd);
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const body = pages[n - 1]?.trim();
    if (body) out.push(`[[page ${n}]]\n${body}`);
  }
  return out.join("\n\n");
}

/** The whole document, for the outline pass. */
export function fullText(pages: string[]): string {
  return pageRangeText(pages, 1, pages.length);
}

/** Rough token estimate for the UI. English averages ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
