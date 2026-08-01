"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Attempt, Chat, Course, Handout, Review } from "./types";

export interface DayUsage {
  day: string;
  handouts: number;
  questions: number;
}

interface SimplifiedDB extends DBSchema {
  courses: { key: string; value: Course };
  handouts: { key: string; value: Handout; indexes: { byCourse: string } };
  files: { key: string; value: { id: string; blob: Blob } };
  reviews: { key: string; value: Review; indexes: { byDue: number } };
  chats: { key: string; value: Chat };
  attempts: { key: string; value: Attempt; indexes: { byQuestion: string } };
  usage: { key: string; value: DayUsage };
}

let dbp: Promise<IDBPDatabase<SimplifiedDB>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<SimplifiedDB>("simplified", 3, {
      // Stepwise so an existing v1 library upgrades in place rather than resetting.
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("courses", { keyPath: "id" });
          const h = d.createObjectStore("handouts", { keyPath: "id" });
          h.createIndex("byCourse", "courseId");
          d.createObjectStore("files", { keyPath: "id" });
          const r = d.createObjectStore("reviews", { keyPath: "cardId" });
          r.createIndex("byDue", "due");
          d.createObjectStore("chats", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          const a = d.createObjectStore("attempts", { keyPath: "id" });
          a.createIndex("byQuestion", "questionId");
        }
        if (oldVersion < 3) {
          d.createObjectStore("usage", { keyPath: "day" });
        }
      },
    });
  }
  return dbp;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ---------- courses ---------- */

export async function listCourses(): Promise<Course[]> {
  const all = await (await db()).getAll("courses");
  return all.sort((a, b) => a.code.localeCompare(b.code));
}

export async function getCourse(id: string) {
  return (await db()).get("courses", id);
}

export async function saveCourse(c: Course) {
  await (await db()).put("courses", c);
  return c;
}

export async function deleteCourse(id: string) {
  const d = await db();
  const hs = await d.getAllFromIndex("handouts", "byCourse", id);
  await Promise.all(hs.map((h) => deleteHandout(h.id)));
  await d.delete("courses", id);
}

/* ---------- handouts ---------- */

export async function listHandouts(courseId?: string): Promise<Handout[]> {
  const d = await db();
  const all = courseId
    ? await d.getAllFromIndex("handouts", "byCourse", courseId)
    : await d.getAll("handouts");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getHandout(id: string) {
  return (await db()).get("handouts", id);
}

export async function saveHandout(h: Handout) {
  await (await db()).put("handouts", h);
  return h;
}

export async function deleteHandout(id: string) {
  const d = await db();
  const h = await d.get("handouts", id);

  // Release the copy held in Files API storage too, so deleting locally really
  // deletes. Best effort — a network failure must not block the local delete.
  if (h?.fileId) {
    fetch(`/api/file?fileId=${encodeURIComponent(h.fileId)}`, { method: "DELETE" }).catch(
      () => {},
    );
  }

  await d.delete("handouts", id);
  await d.delete("files", id);

  const [reviews, attempts, chats] = await Promise.all([
    d.getAll("reviews"),
    d.getAll("attempts"),
    d.getAll("chats"),
  ]);
  await Promise.all([
    ...reviews.filter((r) => r.handoutId === id).map((r) => d.delete("reviews", r.cardId)),
    ...attempts.filter((a) => a.handoutId === id).map((a) => d.delete("attempts", a.id)),
    ...chats.filter((c) => c.handoutId === id).map((c) => d.delete("chats", c.id)),
  ]);
}

/* ---------- pdf blobs ---------- */

export async function saveFile(id: string, blob: Blob) {
  await (await db()).put("files", { id, blob });
}

export async function getFile(id: string) {
  return (await db()).get("files", id);
}

/* ---------- reviews ---------- */

export async function listReviews(): Promise<Review[]> {
  return (await db()).getAll("reviews");
}

export async function saveReview(r: Review) {
  await (await db()).put("reviews", r);
}

export async function saveReviews(rs: Review[]) {
  const d = await db();
  const tx = d.transaction("reviews", "readwrite");
  await Promise.all(rs.map((r) => tx.store.put(r)));
  await tx.done;
}

export async function dueReviews(at = Date.now()): Promise<Review[]> {
  const d = await db();
  return (await d.getAll("reviews")).filter((r) => r.due <= at);
}

/* ---------- exam attempts ---------- */

export async function saveAttempt(a: Attempt) {
  await (await db()).put("attempts", a);
}

export async function listAttempts(): Promise<Attempt[]> {
  return (await db()).getAll("attempts");
}

/** Most recent attempt per question, for showing "last time you scored X". */
export async function latestAttempts(): Promise<Map<string, Attempt>> {
  const all = await listAttempts();
  const map = new Map<string, Attempt>();
  for (const a of all.sort((x, y) => x.createdAt - y.createdAt)) map.set(a.questionId, a);
  return map;
}

/* ---------- daily usage ---------- */

export async function getUsage(day: string): Promise<DayUsage> {
  const row = await (await db()).get("usage", day);
  return row ?? { day, handouts: 0, questions: 0 };
}

export async function saveUsage(u: DayUsage) {
  await (await db()).put("usage", u);
}

/* ---------- chats ---------- */

export async function getChat(id: string) {
  return (await db()).get("chats", id);
}

export async function saveChat(c: Chat) {
  await (await db()).put("chats", c);
}
