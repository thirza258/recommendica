"""
Pipeline error types.

These let the API layer distinguish "a dependency is down" (retryable, 503)
from "the request was bad" (400) and from genuine bugs (500), instead of
turning every failure into an opaque 500 or a silent empty result.
"""


class PipelineError(Exception):
    """Base class for pipeline failures that are safe to report to a caller."""

    #: Short, user-facing message. Subclasses override it.
    default_message = "The recommendation pipeline is unavailable."

    def user_message(self) -> str:
        return str(self) or self.default_message


class DependencyUnavailable(PipelineError):
    """An external dependency (vector store, embedder, LLM) is unreachable."""

    default_message = "A required backend service is unavailable."


class VectorStoreUnavailable(DependencyUnavailable):
    """ChromaDB could not be reached, or the collection could not be opened."""

    default_message = "The vector store (ChromaDB) is unavailable."


class EmbeddingUnavailable(DependencyUnavailable):
    """The embedding backend (Ollama) failed to produce embeddings."""

    default_message = "The embedding service (Ollama) is unavailable."


class LLMUnavailable(DependencyUnavailable):
    """The LLM provider failed after exhausting retries."""

    default_message = "The language model provider is unavailable."


class PipelineNotReady(PipelineError):
    """The pipeline could not be constructed — usually missing configuration."""

    default_message = "The recommendation pipeline is not configured correctly."
