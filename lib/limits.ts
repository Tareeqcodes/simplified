/**
 * The one place the daily and per-file limits are defined.
 *
 * Kept dependency-free on purpose so both sides can import it: the browser
 * counter in lib/quota.ts (a client module that pulls in IndexedDB and Appwrite)
 * and the server enforcer in app/api/quota, which can't import that client module
 * without dragging browser-only code onto the server.
 *
 * Limits are deliberately tighter than feels comfortable. Raising one later is a
 * config change; discovering you owe money is not.
 */
export const LIMITS = {
  /** New digestions per day. Adopting an existing digest does not count. */
  handoutsPerDay: 5,
  pagesPerHandout: 100,
  fileSizeBytes: 20 * 1024 * 1024,
  /** Ask + grade calls per day. Cheap, but not free. */
  questionsPerDay: 50,
} as const;
