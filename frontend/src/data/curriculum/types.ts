export interface CourseLesson {
  id: string;
  title: string;
  minutes: number;
  objective: string;
  sections: { title: string; text: string; points?: string[] }[];
  example: { title: string; text: string };
  exercise: string;
  quiz: {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  };
  practicePrompt?: string;
}

export interface Course {
  id: string;
  title: string;
  category: string;
  description: string;
  outcome: string;
  resources: { title: string; url: string }[];
  lessons: CourseLesson[];
}
