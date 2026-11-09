import type { Course } from "./curriculum/types.ts";
import { createResearch } from "./curriculum/create-research.ts";
import { researchStepByStep } from "./curriculum/research-step-by-step.ts";
import { websiteTutorial } from "./curriculum/website-tutorial.ts";
import { readResearch } from "./curriculum/read-research.ts";
import { systematicReview } from "./curriculum/systematic-review.ts";
import { statisticsEssentials } from "./curriculum/statistics-essentials.ts";
import { writePaper } from "./curriculum/write-paper.ts";
import { latexEssentials } from "./curriculum/latex-essentials.ts";
import { publishResearch } from "./curriculum/publish-research.ts";
import { aiInResearch } from "./curriculum/ai-in-research.ts";

export type { Course, CourseLesson } from "./curriculum/types.ts";

/**
 * The curriculum in catalog order, one course per file in ./curriculum.
 *
 * Course and lesson IDs are permanent: they form the lesson links and key the
 * progress saved in learners' browsers. Add new courses and lessons freely,
 * but never rename or remove a published ID. After any change to courses,
 * lessons, or reading times, run `npm run courses:sync` to refresh the landing
 * page summary and the sitemaps.
 */
export const COURSES: Course[] = [
  createResearch,
  researchStepByStep,
  websiteTutorial,
  readResearch,
  systematicReview,
  statisticsEssentials,
  writePaper,
  latexEssentials,
  publishResearch,
  aiInResearch,
];
