import { isWriteRoute } from "./write/routes.ts";

/**
 * Top-level view routing. Kept apart from the course helpers so the main
 * bundle can route to the courses view without loading the curriculum.
 */
export type View = "landing" | "app" | "courses" | "write" | "legal";

export function viewFromHash(hash: string): View {
  const clean = hash.trim();
  const pathOnly = clean.split("?")[0];
  if (
    clean === "#privacy" ||
    clean === "/privacy" ||
    clean === "#terms" ||
    clean === "/terms" ||
    clean === "#legal" ||
    clean === "/legal" ||
    pathOnly === "#privacy" ||
    pathOnly === "/privacy" ||
    pathOnly === "#terms" ||
    pathOnly === "/terms" ||
    pathOnly === "#legal" ||
    pathOnly === "/legal"
  ) {
    return "legal";
  }
  if (
    clean === "#search" ||
    clean === "/search" ||
    clean.startsWith("#search?") ||
    clean.startsWith("/search?") ||
    pathOnly === "#search" ||
    pathOnly === "/search"
  ) {
    return "app";
  }
  if (
    clean === "#courses" ||
    clean === "/courses" ||
    clean.startsWith("#courses/") ||
    clean.startsWith("/courses/") ||
    pathOnly === "#courses" ||
    pathOnly === "/courses" ||
    pathOnly.startsWith("#courses/") ||
    pathOnly.startsWith("/courses/")
  ) {
    return "courses";
  }
  if (isWriteRoute(clean)) return "write";
  return "landing";
}
