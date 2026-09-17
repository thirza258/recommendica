import { COURSES } from "./data/courses.ts";
import type { Course } from "./data/courses.ts";

export const COURSE_PROGRESS_KEY = "recommendica.course-progress.v1";
export type View = "landing" | "app" | "courses";

export function viewFromHash(hash: string): View {
  if (hash === "#search") return "app";
  return hash === "#courses" || hash.startsWith("#courses/")
    ? "courses"
    : "landing";
}

export function lessonKey(courseId: string, lessonId: string): string {
  return `${courseId}/${lessonId}`;
}

export function lessonHref(courseId: string, lessonId: string): string {
  return `#courses/${lessonKey(courseId, lessonId)}`;
}

/** Unknown or stale lesson links fall back to the catalog, never a blank reader. */
export function resolveLesson(hash: string) {
  const match = /^#courses\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) return null;
  const course = COURSES.find((item) => item.id === match[1]);
  const lesson = course?.lessons.find((item) => item.id === match[2]);
  return course && lesson ? { course, lesson } : null;
}

const validLessonKeys = new Set(
  COURSES.flatMap((course) =>
    course.lessons.map((lesson) => lessonKey(course.id, lesson.id)),
  ),
);

/** Browser storage is optional and may contain an outdated or malformed value. */
export function parseCourseProgress(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (key): key is string =>
            typeof key === "string" && validLessonKeys.has(key),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function nextCourseLesson(course: Course, completed: string[]) {
  return (
    course.lessons.find(
      (lesson) => !completed.includes(lessonKey(course.id, lesson.id)),
    ) ?? course.lessons[0]
  );
}
