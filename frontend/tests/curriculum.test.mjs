import assert from "node:assert/strict";
import test from "node:test";
import { COURSES } from "../src/data/courses.ts";
import { COURSE_CATALOG } from "../src/data/courseCatalog.ts";
import { lessonKey } from "../src/learning.ts";
import { courseSummaries, staleFiles } from "../scripts/sync-courses.mjs";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Saved progress is keyed by these IDs, and progress for unknown keys is
// dropped, so renaming or removing one silently erases learners' progress.
const PUBLISHED_LESSONS = [
  "create-research/research-question",
  "create-research/literature-review",
  "create-research/research-design",
  "create-research/project-proposal",
  "create-research/research-ethics",
  "create-research/hypothesis-or-not",
  "research-step-by-step/plan-and-pilot",
  "research-step-by-step/collect-and-organize",
  "research-step-by-step/analyze-and-interpret",
  "research-step-by-step/write-and-share",
  "research-step-by-step/qualitative-evidence",
  "research-step-by-step/reproducible-analysis",
  "website-tutorial/first-search",
  "website-tutorial/understand-answers",
  "website-tutorial/inspect-sources",
  "website-tutorial/refine-search",
  "website-tutorial/write-your-paper",
  "website-tutorial/export-and-share",
  "read-research/map-the-paper",
  "read-research/evaluate-methods",
  "read-research/interpret-results",
  "read-research/notes-and-citations",
  "read-research/question-the-numbers",
  "read-research/venue-and-version",
  "systematic-review/choose-review-type",
  "systematic-review/review-protocol",
  "systematic-review/search-strategy",
  "systematic-review/screening",
  "systematic-review/extract-and-appraise",
  "systematic-review/synthesize-and-report",
  "statistics-essentials/describe-data",
  "statistics-essentials/samples-and-uncertainty",
  "statistics-essentials/p-values",
  "statistics-essentials/effect-size-and-power",
  "statistics-essentials/correlation-and-regression",
  "statistics-essentials/analysis-pitfalls",
  "write-paper/one-message",
  "write-paper/write-introduction",
  "write-paper/methods-and-results",
  "write-paper/discussion-and-limitations",
  "write-paper/title-and-abstract",
  "write-paper/edit-for-readers",
  "latex-essentials/latex-anatomy",
  "latex-essentials/latex-math",
  "latex-essentials/latex-figures-tables",
  "latex-essentials/latex-citations",
  "latex-essentials/latex-import",
  "latex-essentials/latex-troubleshooting",
  "publish-research/choose-a-venue",
  "publish-research/prepare-submission",
  "publish-research/authorship-and-credit",
  "publish-research/peer-review-process",
  "publish-research/respond-to-reviewers",
  "publish-research/open-access-and-sharing",
  "ai-in-research/match-tool-to-task",
  "ai-in-research/verify-ai-output",
  "ai-in-research/protect-confidential-data",
  "ai-in-research/disclose-ai-use",
  "ai-in-research/ai-in-methods",
  "ai-in-research/bias-and-originality",
];

const filled = (value) => typeof value === "string" && value.trim() !== "";

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert.ok(!seen.has(value), `Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

test("published lessons keep their IDs so saved progress survives", () => {
  const keys = new Set(
    COURSES.flatMap((course) =>
      course.lessons.map((lesson) => lessonKey(course.id, lesson.id)),
    ),
  );
  for (const key of PUBLISHED_LESSONS) {
    assert.ok(keys.has(key), `Removed or renamed lesson: ${key}`);
  }
});

test("every course is complete, linkable, and cites safe further reading", () => {
  assertUnique(
    COURSES.map((course) => course.id),
    "course ID",
  );
  for (const course of COURSES) {
    assert.match(course.id, ID);
    for (const field of ["title", "category", "description", "outcome"]) {
      assert.ok(filled(course[field]), `${course.id} needs a ${field}`);
    }
    assert.ok(course.lessons.length >= 4, `${course.id} is too short`);
    assert.ok(course.resources.length > 0, `${course.id} needs further reading`);
    assertUnique(
      course.resources.map((resource) => resource.url),
      `${course.id} resource`,
    );
    for (const resource of course.resources) {
      assert.ok(filled(resource.title), `${course.id} resource needs a title`);
      assert.equal(new URL(resource.url).protocol, "https:", resource.url);
    }
    assertUnique(
      course.lessons.map((lesson) => lesson.id),
      `${course.id} lesson ID`,
    );
  }
});

test("every lesson teaches, demonstrates, practices, and checks", () => {
  for (const course of COURSES) {
    for (const lesson of course.lessons) {
      const where = lessonKey(course.id, lesson.id);
      assert.match(lesson.id, ID, where);
      assert.ok(filled(lesson.title), `${where} needs a title`);
      assert.ok(filled(lesson.objective), `${where} needs an objective`);
      assert.ok(
        Number.isInteger(lesson.minutes) &&
          lesson.minutes >= 3 &&
          lesson.minutes <= 15,
        `${where} has an implausible reading time`,
      );

      // Section titles, points, and options double as React keys.
      assert.ok(lesson.sections.length >= 3, `${where} needs three sections`);
      assertUnique(
        lesson.sections.map((section) => section.title),
        `${where} section`,
      );
      for (const section of lesson.sections) {
        assert.ok(filled(section.title) && filled(section.text), where);
        if (section.points) {
          assert.ok(section.points.length > 0, `${where} has an empty list`);
          assert.ok(section.points.every(filled), `${where} has a blank point`);
          assertUnique(section.points, `${where} point`);
        }
      }

      assert.ok(filled(lesson.example.title) && filled(lesson.example.text));
      assert.ok(filled(lesson.exercise), `${where} needs an exercise`);

      const { quiz } = lesson;
      assert.ok(filled(quiz.question), `${where} needs a quiz question`);
      assert.ok(quiz.options.length >= 3, `${where} needs three options`);
      assert.ok(quiz.options.every(filled), `${where} has a blank option`);
      assertUnique(quiz.options, `${where} option`);
      assert.ok(Number.isInteger(quiz.answer), where);
      assert.ok(quiz.answer >= 0 && quiz.answer < quiz.options.length, where);
      assert.ok(filled(quiz.explanation), `${where} needs an explanation`);

      if (lesson.practicePrompt !== undefined) {
        assert.ok(filled(lesson.practicePrompt), `${where} has a blank prompt`);
      }
    }
  }
});

test("the landing page catalog summary matches the curriculum", () => {
  assert.deepEqual(COURSE_CATALOG, courseSummaries(COURSES));
});

test("sitemaps list every course and lesson (run `npm run courses:sync`)", () => {
  assert.deepEqual(staleFiles(), []);
});
