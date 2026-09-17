import { useRef, useState } from "react";
import type { Course, CourseLesson } from "../data/courses";
import { lessonHref, lessonKey } from "../learning";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
} from "./Icons";

interface CourseLessonProps {
  course: Course;
  lesson: CourseLesson;
  completed: string[];
  onComplete: (courseId: string, lessonId: string) => void;
  onSearch: (prompt: string) => void;
}

function CourseLessonReader({
  course,
  lesson,
  completed,
  onComplete,
  onSearch,
}: CourseLessonProps) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const nextLessonRef = useRef<HTMLAnchorElement>(null);
  const index = course.lessons.findIndex((item) => item.id === lesson.id);
  const isComplete = completed.includes(lessonKey(course.id, lesson.id));
  const completedCount = course.lessons.filter((item) =>
    completed.includes(lessonKey(course.id, item.id)),
  ).length;
  const courseComplete = completedCount === course.lessons.length;
  const passed = checked && answer === lesson.quiz.answer;
  const previous = course.lessons[index - 1];
  const next = course.lessons[index + 1];
  const practicePrompt = lesson.practicePrompt;

  return (
    <>
      <nav className="learning-breadcrumb" aria-label="Breadcrumb">
        <a href="#courses">All courses</a>
        <ChevronRightIcon />
        <span>{course.title}</span>
      </nav>
      <div className="lesson-layout">
        <aside className="course-outline" aria-label="Course outline">
          <p className="learning-eyebrow">{course.category}</p>
          <h2>{course.title}</h2>
          <p className="course-outline-progress">
            {completedCount} of {course.lessons.length} lessons completed
          </p>
          <progress
            aria-label={`${course.title} completion`}
            value={completedCount}
            max={course.lessons.length}
          />
          <nav aria-label="Lessons">
            <ol>
              {course.lessons.map((item, lessonIndex) => {
                const done = completed.includes(lessonKey(course.id, item.id));
                return (
                  <li key={item.id}>
                    <a
                      href={lessonHref(course.id, item.id)}
                      aria-current={item.id === lesson.id ? "step" : undefined}
                    >
                      <span
                        className={`lesson-number${done ? " lesson-number--done" : ""}`}
                      >
                        {done ? (
                          <CheckIcon size={18} />
                        ) : (
                          String(lessonIndex + 1).padStart(2, "0")
                        )}
                      </span>
                      <span>
                        {item.title}
                        <small>
                          {item.minutes} min{done ? " · Completed" : ""}
                        </small>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          <p className="course-outline-tip">
            Read, try the exercise, then check your understanding. You can
            revisit any lesson.
          </p>
        </aside>

        <article className="lesson-article">
          <header className="lesson-header">
            <p className="learning-eyebrow">
              Lesson {index + 1} of {course.lessons.length}{" "}
              <span aria-hidden="true">/</span> {lesson.minutes} min
            </p>
            <h1 id="learning-heading" tabIndex={-1}>
              {lesson.title}
            </h1>
            <p className="lesson-objective">{lesson.objective}</p>
          </header>
          {lesson.sections.map((section) => (
            <section className="lesson-section" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
              {section.points && (
                <ul>
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <aside className="lesson-example" aria-label="Worked example">
            <p className="learning-eyebrow">In practice</p>
            <h2>{lesson.example.title}</h2>
            <p>{lesson.example.text}</p>
          </aside>
          <section
            className="lesson-exercise"
            aria-labelledby="exercise-heading"
          >
            <p className="learning-eyebrow">
              <GraduationCapIcon size={18} /> Make it yours
            </p>
            <h2 id="exercise-heading">A small exercise</h2>
            <p>{lesson.exercise}</p>
            {practicePrompt && (
              <button
                className="ghost-button"
                type="button"
                onClick={() => onSearch(practicePrompt)}
              >
                Try this in search <ArrowRightIcon />
              </button>
            )}
          </section>
          <form
            className="lesson-quiz"
            onSubmit={(event) => {
              event.preventDefault();
              if (answer !== null) setChecked(true);
            }}
          >
            <p className="learning-eyebrow">Check your understanding</p>
            <fieldset aria-describedby={checked ? "quiz-feedback" : undefined}>
              <legend>{lesson.quiz.question}</legend>
              {lesson.quiz.options.map((option, optionIndex) => (
                <label
                  className={`quiz-option${answer === optionIndex ? " quiz-option--selected" : ""}`}
                  key={option}
                >
                  <input
                    type="radio"
                    name="lesson-answer"
                    value={optionIndex}
                    checked={answer === optionIndex}
                    onChange={() => {
                      setAnswer(optionIndex);
                      setChecked(false);
                    }}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              className="ghost-button"
              disabled={answer === null}
            >
              Check answer
            </button>
            {checked && (
              <div
                id="quiz-feedback"
                className={`quiz-feedback${passed ? " quiz-feedback--correct" : ""}`}
                role="status"
              >
                <strong>
                  {passed ? "That’s right." : "Not quite. Take another look."}
                </strong>
                <p>{lesson.quiz.explanation}</p>
              </div>
            )}
          </form>
          <div className="lesson-completion" aria-live="polite">
            {isComplete ? (
              <p className="learning-completed">
                <CheckIcon size={20} /> Lesson completed. You can review it
                anytime.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!passed}
                  onClick={() => {
                    onComplete(course.id, lesson.id);
                    nextLessonRef.current?.focus();
                  }}
                >
                  Mark lesson complete <CheckIcon size={18} />
                </button>
                <p>
                  {passed
                    ? "Finished the exercise? Save your progress and continue."
                    : "Answer the knowledge check correctly to mark this lesson complete."}
                </p>
              </>
            )}
          </div>
          {courseComplete && (
            <section
              className="course-finished"
              aria-labelledby="course-finished-heading"
            >
              <GraduationCapIcon size={28} />
              <h2 id="course-finished-heading">
                Course complete. Put it into practice.
              </h2>
              <p>
                You’ve worked through every lesson in {course.title}. Bring your
                new skills to your next research question.
              </p>
              <a href="#courses" className="learning-text-link">
                Explore the other courses <ArrowRightIcon />
              </a>
            </section>
          )}
          <nav className="lesson-pagination" aria-label="Lesson navigation">
            {previous ? (
              <a href={lessonHref(course.id, previous.id)}>← Previous lesson</a>
            ) : (
              <a href="#courses">← All courses</a>
            )}
            {next ? (
              <a ref={nextLessonRef} href={lessonHref(course.id, next.id)}>
                Next lesson <ArrowRightIcon />
              </a>
            ) : (
              <a ref={nextLessonRef} href="#courses">
                Back to courses <ArrowRightIcon />
              </a>
            )}
          </nav>
          {course.resources.length > 0 && (
            <aside className="lesson-resources" aria-label="Further reading">
              <h2>Continue reading</h2>
              <ul>
                {course.resources.map((resource) => (
                  <li key={resource.url}>
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {resource.title}
                      <ExternalLinkIcon />
                      <span className="visually-hidden">
                        {" "}
                        (opens in a new tab)
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </article>
      </div>
    </>
  );
}

export default CourseLessonReader;
