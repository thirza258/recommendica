import { useEffect, useState } from "react";
import { COURSES } from "../data/courses";
import {
  COURSE_PROGRESS_KEY,
  lessonHref,
  lessonKey,
  nextCourseLesson,
  parseCourseProgress,
  resolveLesson,
} from "../learning";
import CourseLessonReader from "./CourseLesson";
import TopBar from "./Topbar";
import {
  ArrowRightIcon,
  BookMarkIcon,
  CheckIcon,
  GraduationCapIcon,
  LayersIcon,
  SearchIcon,
} from "./Icons";
import "./Courses.css";

const COURSE_ICONS = [BookMarkIcon, LayersIcon, SearchIcon, GraduationCapIcon];
const totalLessons = COURSES.reduce(
  (sum, course) => sum + course.lessons.length,
  0,
);

interface CoursesProps {
  hash: string;
  onHome: () => void;
  onSearch: (prompt?: string) => void;
  onDonate?: () => void;
}

function Courses({ hash, onHome, onSearch, onDonate }: CoursesProps) {
  const [completed, setCompleted] = useState<string[]>(() => {
    try {
      return parseCourseProgress(
        window.localStorage.getItem(COURSE_PROGRESS_KEY),
      );
    } catch {
      return [];
    }
  });
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const selection = resolveLesson(hash);
  const isCatalogRoute =
    hash === "#courses" ||
    hash === "/courses" ||
    hash === "" ||
    COURSES.some(
      (c) => hash === `#courses/${c.id}` || hash === `/courses/${c.id}`,
    );
  const isMissingLesson = !isCatalogRoute && !selection;
  const courseTitle = selection?.course.title;
  const lessonTitle = selection?.lesson.title;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COURSE_PROGRESS_KEY,
        JSON.stringify(completed),
      );
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }, [completed]);

  useEffect(() => {
    document.title = lessonTitle
      ? `${lessonTitle} — ${courseTitle} — Recommendica`
      : "Research courses — Recommendica";
    document.getElementById("learning-heading")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [hash, courseTitle, lessonTitle]);

  const completeLesson = (courseId: string, lessonId: string) => {
    const key = lessonKey(courseId, lessonId);
    setCompleted((previous) =>
      previous.includes(key) ? previous : [...previous, key],
    );
  };

  return (
    <div className="app-shell learning-shell">
      <a
        className="learning-skip-link"
        href="#learning-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("learning-content")?.focus();
        }}
      >
        Skip to course content
      </a>
      <TopBar
        status="idle"
        onHome={onHome}
        onSearch={() => onSearch()}
        onDonate={onDonate}
        isLearning
      />
      <main className="learning-main" id="learning-content" tabIndex={-1}>
        {selection ? (
          <CourseLessonReader
            key={lessonKey(selection.course.id, selection.lesson.id)}
            course={selection.course}
            lesson={selection.lesson}
            completed={completed}
            onComplete={completeLesson}
            onSearch={onSearch}
          />
        ) : (
          <>
            {isMissingLesson && (
              <p className="learning-notice" role="status">
                This lesson link is unavailable. Choose a course below to
                continue.
              </p>
            )}
            <header className="learning-hero">
              <div>
                <p className="learning-eyebrow">
                  <GraduationCapIcon size={18} /> The Recommendica classroom
                </p>
                <h1 id="learning-heading" tabIndex={-1}>
                  Better research starts{" "}
                  <br />
                  with a little practice.
                </h1>
                <p className="learning-intro">
                  From your first question to your final citation. Build the
                  skills to create research, use Recommendica, and make sense of
                  the evidence.
                </p>
                <div className="learning-meta">
                  <span>4 free courses</span>
                  <span>{totalLessons} practical lessons</span>
                  <span>Learn at your own pace</span>
                </div>
              </div>
              <aside className="learning-start">
                <SearchIcon size={24} />
                <p className="learning-eyebrow">New to Recommendica?</p>
                <h2>Make your first search count.</h2>
                <p>
                  Take a guided tour from a focused question to the papers
                  behind an answer.
                </p>
                <a
                  className="learning-text-link"
                  href={lessonHref("website-tutorial", "first-search")}
                >
                  Start the website tutorial <ArrowRightIcon />
                </a>
              </aside>
            </header>

            <section
              className="learning-progress-overview"
              aria-label="Your learning progress"
            >
              <div>
                <strong>
                  {completed.length === totalLessons
                    ? "All courses completed"
                    : completed.length
                      ? "Keep your learning going"
                      : "Your research journey"}
                </strong>
                <p>
                  {completed.length} of {totalLessons} lessons completed
                </p>
              </div>
              <progress
                aria-label="Overall lesson completion"
                value={completed.length}
                max={totalLessons}
              />
              <span className="learning-progress-percent">
                {Math.round((completed.length / totalLessons) * 100)}%
              </span>
            </section>

            <section aria-labelledby="course-catalog-heading">
              <div className="learning-section-heading">
                <h2 id="course-catalog-heading">Find your next step</h2>
                <p>Start anywhere. Every course is beginner friendly.</p>
              </div>
              <div className="course-grid">
                {COURSES.map((course, index) => {
                  const Icon = COURSE_ICONS[index];
                  const count = course.lessons.filter((lesson) =>
                    completed.includes(lessonKey(course.id, lesson.id)),
                  ).length;
                  const next = nextCourseLesson(course, completed);
                  const finished = count === course.lessons.length;
                  return (
                    <article className="course-card" key={course.id}>
                      <div className="course-card-top">
                        <span className={`course-icon course-icon--${index}`}>
                          <Icon size={24} />
                        </span>
                        <span className="learning-eyebrow">
                          Course {String(index + 1).padStart(2, "0")} /{" "}
                          {course.category}
                        </span>
                      </div>
                      <h3>{course.title}</h3>
                      <p className="course-card-description">
                        {course.description}
                      </p>
                      <p className="learning-meta">
                        {course.lessons.length} lessons{" "}
                        <span aria-hidden="true">·</span> About{" "}
                        {course.lessons.reduce(
                          (sum, lesson) => sum + lesson.minutes,
                          0,
                        )}{" "}
                        min
                      </p>
                      <ol className="course-preview-lessons">
                        {course.lessons.map((lesson) => (
                          <li key={lesson.id}>{lesson.title}</li>
                        ))}
                      </ol>
                      <p className="course-outcome">
                        <strong>You’ll leave with</strong>
                        {course.outcome}
                      </p>
                      <div className="course-card-footer">
                        <span
                          className={
                            finished
                              ? "learning-completed"
                              : "course-card-count"
                          }
                        >
                          {finished && <CheckIcon />}
                          {finished
                            ? "Completed"
                            : `${count}/${course.lessons.length} completed`}
                        </span>
                        <a
                          className="learning-text-link"
                          href={lessonHref(course.id, next.id)}
                          aria-label={`${finished ? "Review" : count ? "Continue" : "Start"} ${course.title}`}
                        >
                          {finished
                            ? "Review course"
                            : count
                              ? "Continue course"
                              : "Start course"}
                          <ArrowRightIcon />
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
        <p
          className="learning-storage-note"
          role={storageUnavailable ? "status" : undefined}
        >
          {storageUnavailable
            ? "Browser storage is unavailable. Progress is kept while this course area is open, but cannot be saved after you leave."
            : "Lesson completion is saved in this browser. No account needed. Clearing browser data clears your progress."}
        </p>
      </main>
    </div>
  );
}

export default Courses;
