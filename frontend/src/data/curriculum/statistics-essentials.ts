import type { Course } from "./types.ts";

export const statisticsEssentials: Course = {
  id: "statistics-essentials",
  title: "Make sense of statistics",
  category: "Data & statistics",
  description:
    "Describe data, quantify uncertainty, and read p-values, effect sizes, and regressions without the classic misinterpretations.",
  outcome:
    "An analysis plan that states your estimates, their uncertainty, and the claims your design supports.",
  resources: [
    {
      title: "OpenIntro Statistics: a free, open-source textbook",
      url: "https://www.openintro.org/book/os/",
    },
    {
      title: "Seeing Theory: a visual introduction to probability and statistics",
      url: "https://seeing-theory.brown.edu/",
    },
    {
      title: "Wasserstein & Lazar (2016): The ASA statement on p-values",
      url: "https://doi.org/10.1080/00031305.2016.1154108",
    },
    {
      title:
        "Greenland et al. (2016): Statistical tests, P values, confidence intervals, and power: a guide to misinterpretations",
      url: "https://doi.org/10.1007/s10654-016-0149-3",
    },
  ],
  lessons: [
    {
      id: "describe-data",
      title: "Describe your data before testing it",
      minutes: 7,
      objective:
        "Summarize variables with the right measures of center and spread, and plot them before any test.",
      sections: [
        {
          title: "Know what kind of variable you have",
          text: "The type of a variable decides how you can summarize it. Categorical variables, such as country or treatment group, are summarized with counts and percentages. Ordinal variables, such as a five-point agreement scale, have an order but uneven steps. Numerical variables, such as age or reaction time, support means and standard deviations, though not always usefully.",
        },
        {
          title: "Center and spread go together",
          text: "A center without a spread hides most of the story. For roughly symmetric data, report the mean with the standard deviation, which describes how far individual values typically fall from the mean. For skewed data, such as income or hospital stay, report the median with the interquartile range, because a few extreme values pull the mean away from typical cases.",
          points: [
            "Mean and SD for roughly symmetric numerical data.",
            "Median and interquartile range for skewed data or data with outliers.",
            "Counts and percentages, with the denominator, for categories.",
          ],
        },
        {
          title: "Plot first, then summarize",
          text: "Very different datasets can share the same mean, standard deviation, and correlation. A histogram or dot plot shows skew, clusters, gaps, and impossible values; a scatter plot shows whether a relationship is curved or driven by a few points. Check missing values too: report how many there are in each variable, and think about why they are missing before choosing how to handle them.",
          points: [
            "Look for impossible values, such as an age of 230, before analyzing.",
            "Report the number of cases behind each summary.",
            "Treat outliers as information to explain, not data to delete quietly.",
          ],
        },
      ],
      example: {
        title: "When the mean misleads",
        text: "Hospital stays for 11 patients: ten stayed 2 to 4 days, and one stayed 60 days. The mean is about 8 days, longer than ten of the eleven stays. The median, 3 days, describes the typical patient, and reporting the 60-day stay separately explains the difference.",
      },
      exercise:
        "Take one numerical variable from a dataset you have, or a table in a paper. Plot it, decide whether it is skewed, and write one sentence summarizing it with a center, a spread, and the number of cases.",
      quiz: {
        question:
          "Household income in your sample is strongly right-skewed. Which summary describes a typical household best?",
        options: [
          "The mean and standard deviation",
          "The median and interquartile range",
          "The maximum value",
        ],
        answer: 1,
        explanation:
          "A few very high incomes pull the mean upward. The median and interquartile range describe the middle of the distribution without being dominated by extremes.",
      },
      practicePrompt:
        "How does visualizing data reveal patterns that summary statistics hide?",
    },
    {
      id: "samples-and-uncertainty",
      title: "From a sample to a population",
      minutes: 8,
      objective:
        "Explain sampling variability, the standard error, and what a confidence interval does and does not say.",
      sections: [
        {
          title: "Every sample gives a slightly different answer",
          text: "A sample statistic, such as the mean of 50 survey responses, estimates a population value. Draw a different sample and you get a different estimate; this is sampling variability. The standard error measures how much an estimate would vary across repeated samples. For a mean it is roughly the standard deviation divided by the square root of the sample size, so quadrupling the sample halves the standard error.",
          points: [
            "Standard deviation: the spread of individual observations.",
            "Standard error: the precision of an estimate, such as a mean.",
            "Bigger samples shrink the standard error, not the standard deviation.",
          ],
        },
        {
          title: "Size cannot fix a biased sample",
          text: "A large sample reduces random error but does nothing about systematic error. An online poll with 100,000 self-selected respondents can be further from the truth than a well-designed random sample of 1,000. Before trusting precision, ask who could have ended up in the sample and who could not.",
        },
        {
          title: "Read a confidence interval correctly",
          text: "A 95% confidence interval comes from a procedure that, under the model's assumptions, captures the true value in 95% of repeated samples. Any single interval either contains the true value or does not; it is not a 95% probability statement about that interval. A practical reading: the interval shows the values reasonably compatible with the data, given the model. Wide intervals are an honest signal of how little the data pin down.",
          points: [
            "Report the interval with the estimate, not instead of it.",
            "Read both ends: could the true effect be negligible, or large?",
            "Remember the interval assumes the model and sampling are sound.",
          ],
        },
      ],
      example: {
        title: "Two surveys, one estimate",
        text: "Two surveys estimate that 40% of students use a study app. The first asked 100 randomly chosen students: 95% CI about 30% to 50%. The second asked 1,600: 95% CI about 38% to 42%. Both centers agree; the larger random sample pins the value down far more tightly.",
      },
      exercise:
        "Find a result reported with a confidence interval. Write one sentence describing the estimate and the range of values compatible with the data, without saying there is a 95% chance the true value lies in that interval.",
      quiz: {
        question:
          "A study reports a mean difference of 4 points, 95% CI 1 to 7. Which statement is correct?",
        options: [
          "Values from about 1 to 7 points are reasonably compatible with the data, given the model.",
          "There is a 95% probability that the true difference lies between 1 and 7.",
          "95% of participants improved by between 1 and 7 points.",
        ],
        answer: 0,
        explanation:
          "The 95% describes the long-run behavior of the interval procedure, not the probability for this one interval. The interval also concerns the mean difference, not individual participants.",
      },
      practicePrompt:
        "How do researchers misinterpret confidence intervals, and how should they be reported?",
    },
    {
      id: "p-values",
      title: "Read and report p-values correctly",
      minutes: 7,
      objective:
        "State what a p-value measures, what it does not, and how to report a test result usefully.",
      sections: [
        {
          title: "What a p-value is",
          text: "A test starts from a null hypothesis, often 'no difference' or 'no association'. The p-value is the probability of getting data at least as extreme as those observed if the null hypothesis and every other assumption of the model were true. A small p-value says the data would be unusual under that model. It does not say which part of the model is wrong, or by how much.",
        },
        {
          title: "What a p-value is not",
          text: "Most misreadings of p-values swap the condition and the conclusion. The p-value is computed assuming the null is true, so it cannot be the probability that the null is true. It also says nothing about the size or importance of an effect: with a large sample, a trivial difference can yield a tiny p-value, and with a small sample, an important difference can yield a large one.",
          points: [
            "Not the probability that the null hypothesis is true.",
            "Not the probability that the result arose 'by chance alone'.",
            "Not a measure of effect size or practical importance.",
          ],
        },
        {
          title: "Report more than a verdict",
          text: "The 0.05 threshold is a convention, not a law of nature, and p = 0.049 and p = 0.051 carry nearly the same evidence. Report the exact p-value together with the estimated effect and its confidence interval, and say which test you used. A result above the threshold is not evidence of no effect: check whether the interval also includes effects large enough to matter.",
          points: [
            "Report the effect estimate, its interval, and the exact p-value.",
            "Name the test and the hypothesis it compared.",
            "Read a non-significant result through its interval, not its p-value.",
          ],
        },
      ],
      example: {
        title: "Same p-value, different stories",
        text: "Trial A: blood pressure fell 1 mmHg more with a new drug, p = 0.01, from 6,000 patients. Trial B: it fell 12 mmHg more, p = 0.01, from 40 patients. The p-values match, but Trial A estimates a precise, tiny effect and Trial B a large, imprecise one. Only the estimates and intervals reveal that difference.",
      },
      exercise:
        "Find one 'statistically significant' result in a paper. Rewrite the sentence so it reports the effect size, its interval, and the p-value, and add one sentence on whether the effect is large enough to matter.",
      quiz: {
        question: "A test gives p = 0.03. Which statement is correct?",
        options: [
          "There is a 3% probability that the null hypothesis is true.",
          "The effect is large enough to matter in practice.",
          "Data this extreme would occur 3% of the time if the null hypothesis and the model's assumptions were true.",
        ],
        answer: 2,
        explanation:
          "The p-value is computed assuming the null and the model. It is not the probability of the null, and it says nothing about practical importance.",
      },
      practicePrompt:
        "What does the American Statistical Association statement on p-values recommend?",
    },
    {
      id: "effect-size-and-power",
      title: "Plan with effect sizes and power",
      minutes: 7,
      objective:
        "Express results as effect sizes and choose a sample size that can detect the effect you care about.",
      sections: [
        {
          title: "Say how big, in units that matter",
          text: "An effect size states how large a difference or association is. Raw differences in meaningful units, such as 3 days shorter recovery, are usually clearest. Standardized measures, such as Cohen's d, risk ratios, odds ratios, or the correlation r, allow comparison across studies. Labels like 'small' or 'large' are rough conventions; whether an effect matters depends on the context and the cost of acting on it.",
        },
        {
          title: "Power is planned before data collection",
          text: "Statistical power is the probability that a study detects an effect of a specified size, if that effect exists, at a chosen significance level. It depends on the effect size, the variability of the data, and the sample size. Plan the sample size from the smallest effect worth detecting, not from the largest effect you hope for, and record the calculation in your plan.",
          points: [
            "Decide the smallest effect that would matter in practice.",
            "Estimate variability from pilot data or earlier studies.",
            "Compute the sample size before collecting data, and report it.",
          ],
        },
        {
          title: "Why small studies mislead",
          text: "Underpowered studies often miss real effects. When they do reach significance, they tend to overestimate the effect, because only the luckiest, largest estimates clear the threshold. A surprising, large effect from a small study is therefore a reason for a replication, not a conclusion. Calculating 'observed power' after the fact adds nothing beyond the p-value.",
        },
      ],
      example: {
        title: "Planning a teaching study",
        text: "A team wants to detect a 5-point improvement on a 100-point exam, where scores have a standard deviation of about 15. That is a standardized effect of about 0.33. For 80% power at the 0.05 level, a two-group comparison needs roughly 140 students per group. With the 30 per group they can recruit, they redesign the study as a pilot and say so.",
      },
      exercise:
        "For your own study, write the smallest effect that would matter and why. Use a free power calculator to find the sample size needed for 80% power, and note what you would change if you cannot reach it.",
      quiz: {
        question:
          "A small study finds a surprisingly large, statistically significant effect. What is the most reasonable reading?",
        options: [
          "The true effect is probably at least as large as reported.",
          "The estimate may be exaggerated, so a larger replication is needed.",
          "Small studies cannot produce significant results, so it must be an error.",
        ],
        answer: 1,
        explanation:
          "In underpowered studies, only large estimates reach significance, so published significant results tend to overstate the true effect.",
      },
      practicePrompt:
        "How does low statistical power affect the reliability of published research findings?",
    },
    {
      id: "correlation-and-regression",
      title: "Correlation, regression, and confounding",
      minutes: 8,
      objective:
        "Interpret correlations and regression coefficients as associations, and recognize when a causal reading needs more.",
      sections: [
        {
          title: "What a correlation measures",
          text: "The correlation coefficient r measures the strength of a linear association between two variables, from -1 to 1. It can miss strong curved relationships, and a few extreme points can create or hide a correlation. Always look at the scatter plot. And r = 0.3 does not mean 30% of anything; r² is the share of variance in one variable that the linear relationship accounts for.",
        },
        {
          title: "What a regression coefficient means",
          text: "A regression coefficient estimates how much the outcome differs, on average, between cases that differ by one unit in a predictor, holding the other predictors in the model constant. That is an association within the model. It becomes a causal effect only if the design supports it, for example through random assignment, or if strong assumptions hold, such as having measured every important confounder.",
          points: [
            "Interpret coefficients in the units of the variables.",
            "Check the residuals for curvature, outliers, and unequal spread.",
            "Too many predictors for the sample size will fit noise.",
          ],
        },
        {
          title: "Confounding and reverse causation",
          text: "A confounder influences both the predictor and the outcome, producing an association without a direct effect. Ice cream sales and drownings rise together because hot weather drives both. Reverse causation reads the arrow the wrong way. Adjusting for measured confounders helps, but unmeasured ones remain, and adjusting for a variable that the predictor itself causes can introduce bias rather than remove it.",
          points: [
            "Ask what could cause both variables before reading an arrow.",
            "Decide adjustment variables from subject knowledge, before seeing results.",
            "Use causal language only when the design earns it.",
          ],
        },
      ],
      example: {
        title: "Coffee and heart disease",
        text: "Early observational studies linked coffee drinking with heart disease. Coffee drinkers also smoked more, and smoking causes heart disease. After adjusting for smoking, much of the association disappeared. The raw correlation was real; the causal reading was not supported.",
      },
      exercise:
        "Find a headline that claims one thing 'boosts' or 'causes' another based on an observational study. List two possible confounders and one way the arrow might run backwards, then rewrite the headline in associational language.",
      quiz: {
        question:
          "An observational study finds that people who exercise more report less depression, adjusting for age and income. What can you conclude?",
        options: [
          "Exercise is associated with less depression, after adjusting for age and income.",
          "Exercise causes less depression.",
          "Depression causes people to exercise less, so exercise has no effect.",
        ],
        answer: 0,
        explanation:
          "Adjustment for two variables leaves other confounders and reverse causation possible. The design supports an adjusted association, not a causal claim in either direction.",
      },
      practicePrompt:
        "What methods do observational studies use to address confounding when estimating causal effects?",
    },
    {
      id: "analysis-pitfalls",
      title: "Avoid the classic analysis traps",
      minutes: 7,
      objective:
        "Recognize multiple comparisons, flexible analysis, and paradoxes that make chance look like a finding.",
      sections: [
        {
          title: "Many tests, some false alarms",
          text: "At a 0.05 threshold, each test of a true null hypothesis has a 5% chance of a false positive. Run 20 independent tests where nothing is going on, and the chance that at least one comes out 'significant' is about 64%. Testing many outcomes, subgroups, or time points without correction, and reporting only the hits, manufactures findings.",
          points: [
            "Name a primary outcome in advance.",
            "Report every test you ran, not only the significant ones.",
            "Use a correction, or present secondary results as exploratory.",
          ],
        },
        {
          title: "Flexible analysis and preregistration",
          text: "Analysts make dozens of reasonable choices: which outliers to exclude, which covariates to include, how to define the outcome. Making them after seeing the data, even with good intentions, lets chance steer the result. Writing an analysis plan before collecting or examining the data, and preregistering it where suitable, separates planned confirmatory tests from exploration. Exploratory findings are still valuable when they are labeled as such.",
        },
        {
          title: "Paradoxes worth recognizing",
          text: "Simpson's paradox occurs when a trend in every subgroup reverses once the groups are combined, because the groups differ in size and baseline. Regression to the mean occurs when cases selected for extreme scores score closer to average next time, with or without any intervention. Both make ordinary data look like an effect; a control group and attention to how cases were selected protect against them.",
        },
      ],
      example: {
        title: "A tutoring program that 'worked'",
        text: "Students with the lowest scores on a September test joined a tutoring program, and their December scores rose markedly. Part of that rise is regression to the mean: very low scores partly reflect a bad day. A comparison group of similarly low-scoring students without tutoring is needed to separate the program's effect from the bounce back.",
      },
      exercise:
        "Write a short analysis plan for your study: the primary outcome, the main comparison, how you will handle missing data and outliers, and which analyses you will label exploratory.",
      quiz: {
        question:
          "A study tests 20 outcomes, finds one with p = 0.04, and reports only that one. What is the main problem?",
        options: [
          "The p-value is too close to 0.05 to be published.",
          "With 20 tests, one false positive is likely even if nothing is going on, and the other tests are hidden.",
          "There is no problem if the sample was large.",
        ],
        answer: 1,
        explanation:
          "Multiple testing inflates false positives, and selective reporting hides the denominator. A large sample does not fix either issue.",
      },
      practicePrompt:
        "Does preregistration reduce false-positive findings in published research?",
    },
  ],
};
