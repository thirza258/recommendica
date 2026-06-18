from typing import List, Optional
import re
from django.conf import settings


class ConfidenceGate:
    def __init__(
        self,
        alpha: Optional[float] = None,
        beta: Optional[float] = None,
        gamma: Optional[float] = None,
        threshold: Optional[float] = None,
    ):
        self.alpha = alpha if alpha is not None else settings.CONFIDENCE_ALPHA
        self.beta = beta if beta is not None else settings.CONFIDENCE_BETA
        self.gamma = gamma if gamma is not None else settings.CONFIDENCE_GAMMA
        self.threshold = threshold if threshold is not None else settings.CONFIDENCE_THRESHOLD

    @staticmethod
    def _keyword_overlap(query: str, docs: List[str]) -> float:
        query_terms = set(re.findall(r"\w+", query.lower()))

        if not query_terms:
            return 0.0

        corpus = " ".join(docs).lower()
        matched = sum(
            1 for term in query_terms
            if term in corpus
        )

        return matched / len(query_terms)

    @staticmethod
    def _consistency_score(distances: List[float]) -> float:
        """
        Measure retrieval consistency.

        Example:
            [0.12, 0.15, 0.17, 0.18]
            -> high consistency

            [0.12, 0.60, 0.75, 0.80]
            -> low consistency
        """
        if len(distances) < 2:
            return 1.0

        top1_sim = 1 - distances[0]
        avg_sim = sum(1 - d for d in distances) / len(distances)

        if top1_sim <= 0:
            return 0.0

        return max(0.0, min(1.0, avg_sim / top1_sim))

    def compute_score(
        self,
        query: str,
        docs: List[str],
        distances: List[float],
    ) -> float:
        if not docs or not distances:
            return 0.0

        similarity = max(0.0, min(1.0, 1 - distances[0]))

        consistency = self._consistency_score(distances)

        overlap = self._keyword_overlap(query, docs)

        confidence = (
            self.alpha * similarity
            + self.beta * consistency
            + self.gamma * overlap
        )

        return round(confidence, 4)

    def should_use_chroma(
        self,
        query: str,
        docs: List[str],
        distances: List[float],
    ) -> bool:
        score = self.compute_score(
            query=query,
            docs=docs,
            distances=distances,
        )

        return score >= self.threshold
