"""Cheap routing of research steps, revised when retrieval needs more coverage.

These heuristics choose work, not factual confidence. Relevance grading and
the full answer audit remain mandatory regardless of the selected steps.
"""

from dataclasses import dataclass, replace
import re


@dataclass(frozen=True)
class ResearchPlan:
    reason: str
    hyde: bool = False
    step_back: bool = False
    fusion: bool = False
    escalated: bool = False

    @property
    def expanded(self):
        return self.hyde or self.step_back or self.fusion

    def broaden(self):
        return replace(
            self, hyde=True, step_back=True, fusion=True, escalated=True,
            reason="The first search needs stronger evidence, so the search is expanding.",
        )

    def as_payload(self):
        # Steps describe the enabled plan; progress events report actual work.
        steps = ["focused_search", "relevance_check", "evidence_review"]
        if self.hyde:
            steps.append("concept_search")
        if self.step_back:
            steps.append("broader_context")
        if self.fusion:
            steps.append("multiple_queries")
        if self.expanded:
            steps.append("reranking")
        return {
            "strategy": "expanded" if self.expanded else "focused",
            "reason": self.reason,
            "steps": steps,
            "escalated": self.escalated,
        }


def plan_research(query: str) -> ResearchPlan:
    """Select independent steps without adding a planner model round trip.

    Short questions with no matching cue start focused. This is a starting
    point only: weak or scarce evidence can broaden *any* question afterward.
    """
    query = query.casefold()
    comparison = bool(re.search(
        r"\b(compar\w*|versus|vs\.?|trade[- ]?offs?|differences?|contradict\w*|conflict\w*)\b", query
    ))
    synthesis = bool(re.search(
        r"\b(comprehensive|in[- ]depth|deep analysis|systematic review|literature review|"
        r"meta[- ]analysis|consensus|synthesi\w*|state of the art)\b", query
    ))
    explanation = bool(re.search(r"\b(why|mechanisms?|causal|causality)\b", query))
    consequential = bool(re.search(
        r"\b(safety|dosage|diagnos\w*|treatments?|therap\w*|clinical|medical|"
        r"legal|financial|adverse|side effects?)\b", query
    ))
    multipart = len(query.split()) >= 35 or query.count("?") > 1
    expanded = comparison or synthesis or explanation or consequential or multipart
    return ResearchPlan(
        hyde=explanation or synthesis,
        step_back=comparison or explanation or synthesis or multipart,
        fusion=comparison or synthesis or consequential or multipart,
        reason=(
            "This question needs broader evidence and comparison before drawing conclusions."
            if expanded else
            "Starting with a focused search; more research will be added if the evidence is weak."
        ),
    )
