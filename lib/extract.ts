"use client";

import { extractPdf, normaliseForHash, sha256, type ExtractedPdf } from "./pdf";

/**
 * One entry point for every handout format. Whatever comes in — PDF, PowerPoint,
 * Word, or plain text — comes out as the same page-indexed shape pdf.js already
 * produces, so the rest of the pipeline (outline, sections, page citations,
 * dedupe) never has to know which format it started as.
 *
 * The heavy per-format parsers (mammoth, JSZip) are imported on demand, so a
 * student who only ever uploads PDFs never downloads them.
 */

/** ~words per synthetic page for formats with no real pagination (docx, txt). */
const WORDS_PER_PAGE = 500;
/** Below this, there's no usable text — almost always images of slides/pages. */
const MIN_CHARS = 40;

type Kind = "pdf" | "pptx" | "docx" | "text" | "legacy-office" | "unknown";

function kindOf(file: File): Kind {
  const name = file.name.toLowerCase();
  const type = file.type;
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    name.endsWith(".pptx")
  )
    return "pptx";
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  )
    return "docx";
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return "text";
  if (name.endsWith(".ppt") || name.endsWith(".doc")) return "legacy-office";
  return "unknown";
}

export function isSupportedFile(file: File): boolean {
  const k = kindOf(file);
  return k === "pdf" || k === "pptx" || k === "docx" || k === "text";
}

/** Only a PDF can be handed to the model as a raw file; everything else must be
 * turned into text here first, because the providers can't read Office binaries. */
export function providerCanReadRaw(file: File): boolean {
  return kindOf(file) === "pdf";
}

/** The file input's accept attribute — extensions and mime types both. */
export const UPLOAD_ACCEPT = [
  ".pdf",
  ".pptx",
  ".docx",
  ".txt",
  ".md",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
].join(",");

/** One line explaining why a file was rejected, or null when it's accepted. */
export function unsupportedReason(file: File): string | null {
  const k = kindOf(file);
  if (k === "legacy-office")
    return "That's an older Office format. Open it and “Save As” .pptx or .docx (or export a PDF), then upload that.";
  if (k === "unknown")
    return "Unsupported file. Upload a PDF, PowerPoint (.pptx), Word (.docx) or a text file.";
  return null;
}

export async function extractDocument(file: File): Promise<ExtractedPdf> {
  switch (kindOf(file)) {
    case "pdf":
      return extractPdf(file);
    case "pptx":
      return extractPptx(file);
    case "docx":
      return extractDocx(file);
    case "text":
      return extractText(file);
    default:
      throw new Error(unsupportedReason(file) ?? "Unsupported file type.");
  }
}

/** Group paragraphs into ~WORDS_PER_PAGE pages, keeping paragraph breaks intact. */
function paginate(text: string): string[] {
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pages: string[] = [];
  let buf: string[] = [];
  let count = 0;
  for (const p of paras) {
    const words = p.split(/\s+/).length;
    if (count + words > WORDS_PER_PAGE && buf.length) {
      pages.push(buf.join("\n\n"));
      buf = [];
      count = 0;
    }
    buf.push(p);
    count += words;
  }
  if (buf.length) pages.push(buf.join("\n\n"));
  if (!pages.length && text.trim()) pages.push(text.trim());
  return pages;
}

/** Build the shared extracted shape from already-recovered page text. */
async function finalise(file: File, pages: string[]): Promise<ExtractedPdf> {
  const charCount = pages.reduce((n, p) => n + p.length, 0);
  if (charCount < MIN_CHARS) {
    throw new Error(
      "No readable text in this file — it looks like images rather than text. Export it as a PDF and upload that instead.",
    );
  }
  const bytes = await file.arrayBuffer();
  const fileHash = await sha256(bytes);
  const normalised = normaliseForHash(pages.join(" "));
  const contentHash = normalised.length > 200 ? await sha256(normalised) : fileHash;
  // isScanned is always false: we only reach here with real extracted text.
  return { pages, pageCount: pages.length, isScanned: false, fileHash, contentHash, charCount };
}

async function extractText(file: File): Promise<ExtractedPdf> {
  return finalise(file, paginate(await file.text()));
}

async function extractDocx(file: File): Promise<ExtractedPdf> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return finalise(file, paginate(value));
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&"); // last, so we don't double-decode
}

/** Pull the visible text runs (`<a:t>`) out of one slide's XML. */
function slideText(xml: string): string {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decodeXmlEntities(m[1]))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function slideIndex(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

async function extractPptx(file: File): Promise<ExtractedPdf> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Each slide becomes a "page", in slide order, so a citation like p.4 lands on
  // slide 4. Image-only slides come back empty and are simply never cited.
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideIndex(a) - slideIndex(b));

  const pages: string[] = [];
  for (const name of names) {
    pages.push(slideText(await zip.files[name].async("string")));
  }
  return finalise(file, pages);
}
