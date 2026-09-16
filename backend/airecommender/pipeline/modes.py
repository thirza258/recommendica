"""Public search modes shared by request validation and the pipeline."""

from enum import Enum


class SearchMode(str, Enum):
    ADAPTIVE = "adaptive"
    # Retained for clients that used the earlier API. The app uses ADAPTIVE.
    FAST = "fast"
    DEEP = "deep"


DEFAULT_SEARCH_MODE = SearchMode.ADAPTIVE.value
