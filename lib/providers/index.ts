import "server-only";
import { claudeProvider, describeError } from "./claude";
import { geminiProvider } from "./gemini";
import type { Provider } from "./types";

/**
 * One switch for the whole app.
 *
 *   AI_PROVIDER=claude   (default — local development)
 *   AI_PROVIDER=gemini   (public deployment)
 *
 * Nothing else differs between environments.
 */
export function provider(): Provider {
  const name = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  switch (name) {
    case "gemini":
      return geminiProvider;
    case "claude":
    case "anthropic":
      return claudeProvider;
    default:
      return claudeProvider;
  }
}

export { describeError };
export type * from "./types";
