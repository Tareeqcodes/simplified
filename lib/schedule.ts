import type { Card, Review } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Grades: 0 = missed, 1 = hard, 2 = good, 3 = easy.
 * SM-2 with a shorter early ladder — a semester of revision, not years.
 */
export function grade(r: Review, g: 0 | 1 | 2 | 3, now = Date.now()): Review {
  let { ease, intervalDays, reps, lapses } = r;

  if (g === 0) {
    lapses += 1;
    reps = 0;
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    ease = Math.max(1.3, Math.min(2.8, ease + (g === 1 ? -0.15 : g === 2 ? 0 : 0.1)));
    if (reps === 1) intervalDays = g === 1 ? 1 : 2;
    else if (reps === 2) intervalDays = g === 1 ? 2 : 4;
    else intervalDays = Math.round(intervalDays * ease * (g === 1 ? 0.6 : 1));
    intervalDays = Math.max(1, Math.min(intervalDays, 90));
  }

  return {
    ...r,
    ease,
    intervalDays,
    reps,
    lapses,
    lastGrade: g,
    // A missed card comes back in ten minutes, not tomorrow.
    due: g === 0 ? now + 10 * 60 * 1000 : now + intervalDays * DAY,
  };
}

export function newReview(card: Card, courseId: string): Review {
  return {
    cardId: card.id,
    handoutId: card.handoutId,
    courseId,
    ease: 2.3,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    due: Date.now(),
  };
}

/**
 * Readiness = how much of the course you have actually retained, not how much
 * you have opened. A card counts fully once it survives to a 7-day interval.
 */
export function readiness(reviews: Review[], totalCards: number): number {
  if (totalCards === 0) return 0;
  const score = reviews.reduce((sum, r) => {
    if (r.reps === 0) return sum;
    return sum + Math.min(1, r.intervalDays / 7);
  }, 0);
  return Math.round((score / totalCards) * 100);
}

/** Cards you keep getting wrong — what the dashboard surfaces as weak spots. */
export function weakSpots(reviews: Review[]): Review[] {
  return reviews
    .filter((r) => r.lapses >= 2)
    .sort((a, b) => b.lapses - a.lapses);
}
