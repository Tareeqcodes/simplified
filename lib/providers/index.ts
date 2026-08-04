import "server-only";
import { claudeProvider, describeError } from "./claude";
import { geminiProvider } from "./gemini";
import type { Provider } from "./types";

/**
 * One switch for the whole app.
 *
 *   AI_PROVIDER=gemini   (default — dev and public deployment)
 *   AI_PROVIDER=claude   (opt in when you have Anthropic credit)
 *
 * Nothing else differs between environments. `||` (not `??`) so an empty
 * AI_PROVIDER= line falls through to the default rather than to no provider.
 */
export function provider(): Provider {
  const name = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  switch (name) {
    case "claude":
    case "anthropic":
      return claudeProvider;
    case "gemini":
    default:
      return geminiProvider;
  }
}

export { describeError };
export type * from "./types";
