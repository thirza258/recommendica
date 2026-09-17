import assert from "node:assert/strict";
import test from "node:test";
import { COURSES } from "../src/data/courses.ts";
import {
  lessonHref,
  lessonKey,
  nextCourseLesson,
  parseCourseProgress,
  resolveLesson,
  viewFromHash,
} from "../src/learning.ts";

test("course and search routes coexist with existing landing section anchors", () => {
  assert.equal(viewFromHash("#courses"), "courses");
  assert.equal(
    viewFromHash("#courses/create-research/research-question"),
    "courses",
  );
  assert.equal(viewFromHash("#search"), "app");
  for (const hash of [
    "",
    "#home",
    "#faq",
    "#disciplines",
    "#methodology",
    "#courses-other",
  ]) {
    assert.equal(viewFromHash(hash), "landing");
  }
});

test("every curriculum link resolves to a unique lesson with an answerable knowledge check", () => {
  const hrefs = new Set();
  for (const course of COURSES) {
    assert.ok(course.lessons.length > 0);
    for (const lesson of course.lessons) {
      const href = lessonHref(course.id, lesson.id);
      assert.ok(!hrefs.has(href), `Duplicate lesson link: ${href}`);
      hrefs.add(href);
      assert.deepEqual(resolveLesson(href), { course, lesson });
      assert.ok(lesson.sections.length > 0);
      assert.ok(lesson.quiz.options.length >= 2);
      assert.ok(Number.isInteger(lesson.quiz.answer));
      assert.ok(
        lesson.quiz.answer >= 0 &&
          lesson.quiz.answer < lesson.quiz.options.length,
      );
      assert.ok(lesson.quiz.explanation.trim());
    }
  }
});

test("unknown and malformed course links safely return to the catalog", () => {
  for (const hash of [
    "#courses",
    "#courses/missing",
    "#courses/missing/lesson",
    "#courses/create-research/missing",
    "#courses/create-research/research-question/extra",
    "#courses/%/bad",
    "#faq",
  ]) {
    assert.equal(resolveLesson(hash), null);
  }
});

test("progress tolerates invalid, stale, duplicated, and non-string browser data", () => {
  for (const value of [
    null,
    "",
    "broken json",
    "null",
    "{}",
    "true",
    "42",
    '"not an array"',
  ]) {
    assert.deepEqual(parseCourseProgress(value), []);
  }
  const key = lessonKey(COURSES[0].id, COURSES[0].lessons[0].id);
  assert.deepEqual(
    parseCourseProgress(
      JSON.stringify([key, key, "retired/lesson", 8, null, {}, [key]]),
    ),
    [key],
  );
});

test("resume finds the earliest incomplete lesson even when lessons were taken out of order", () => {
  const course = COURSES[0];
  const completed = [course.lessons[1], course.lessons[3]].map((lesson) =>
    lessonKey(course.id, lesson.id),
  );
  assert.equal(nextCourseLesson(course, completed), course.lessons[0]);
  completed.push(lessonKey(course.id, course.lessons[0].id));
  assert.equal(nextCourseLesson(course, completed), course.lessons[2]);
});

test("completed courses can be reviewed and do not complete another course", () => {
  const course = COURSES[0];
  const completed = course.lessons.map((lesson) =>
    lessonKey(course.id, lesson.id),
  );
  assert.equal(nextCourseLesson(course, completed), course.lessons[0]);
  assert.equal(nextCourseLesson(COURSES[1], completed), COURSES[1].lessons[0]);
  assert.deepEqual(parseCourseProgress(JSON.stringify(completed)), completed);
});
