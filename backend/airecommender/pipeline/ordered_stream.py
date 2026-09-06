"""
Run producers concurrently, emit their output in order.

The pipeline generates one LLM answer per document chunk.  Doing that
sequentially makes the wall-clock cost the *sum* of every chunk's generation
time, even though the chunks do not depend on each other.  Doing it
concurrently but emitting tokens as they arrive would interleave three
different answers in the SSE stream and break the client's contract.

``stream_in_order`` gives us both: every producer runs in its own thread right
away, but the consumer drains producer 0 to completion before touching
producer 1.  Chunk 1 still streams live token-by-token, and by the time the
consumer reaches chunk 2 its tokens are usually already buffered, so they flush
instantly.  Total time becomes the *slowest* chunk instead of the sum, and the
emitted event order is byte-for-byte what a sequential run would produce.

Trade-off worth knowing: because later producers start eagerly, an aborted
request has already paid for work whose output nobody will read.  The
``cancel_event`` bounds that — producers stop at their next yield once it is
set — but tokens already generated are still billed.
"""

from __future__ import annotations

import logging
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Iterator, Optional, Sequence

logger = logging.getLogger(__name__)

#: How often a blocked consumer/producer re-checks the cancel flag.
DEFAULT_POLL_INTERVAL = 0.2

#: Runaway backstop — a single producer should never emit more than this many
#: items.  Normal LLM answers are a few thousand tokens.
DEFAULT_MAX_ITEMS_PER_PRODUCER = 200_000

_ITEM = "item"
_ERROR = "error"
_DONE = "done"


@dataclass
class ProducerError:
    """Raised-and-captured failure from one producer, surfaced in stream order."""

    index: int
    exc: BaseException


def stream_in_order(
    producers: Sequence[Callable[[], Any]],
    *,
    max_workers: int = 3,
    cancel_event: Optional[threading.Event] = None,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    max_items_per_producer: int = DEFAULT_MAX_ITEMS_PER_PRODUCER,
    thread_name_prefix: str = "ordered-stream",
) -> Iterator[Any]:
    """
    Run *producers* concurrently and yield their items grouped in order.

    Parameters
    ----------
    producers:
        Zero-argument callables, each returning an iterable of items.  They run
        in worker threads, so they must not touch request-local state.
    max_workers:
        How many producers may run at once.  The rest queue up, in order.
    cancel_event:
        Set by the caller (e.g. on client disconnect) to abandon the work.
        Producers stop at their next item; the consumer stops yielding.
    max_items_per_producer:
        Safety cap; a producer exceeding it is truncated with a warning.

    Yields
    ------
    Items from producer 0 in order, then producer 1, and so on.  A producer
    that raises contributes a :class:`ProducerError` at its position instead of
    propagating — one failing chunk must not lose the others' output.
    """
    producer_list = list(producers)
    if not producer_list:
        return

    # Internal stop flag: set when the consumer abandons the stream (client
    # disconnect, exception upstream).  Kept separate from *cancel_event* so
    # that finishing normally never cancels the caller's other stages.
    stop = threading.Event()

    def cancelled() -> bool:
        return stop.is_set() or (cancel_event is not None and cancel_event.is_set())

    queues: list[queue.SimpleQueue] = [queue.SimpleQueue() for _ in producer_list]

    def run_producer(index: int, producer: Callable[[], Any], sink: queue.SimpleQueue):
        emitted = 0
        try:
            if cancelled():
                return
            for item in producer():
                if cancelled():
                    logger.debug(
                        "[STREAM] Producer %s cancelled after %s items", index, emitted
                    )
                    return
                sink.put((_ITEM, item))
                emitted += 1
                if emitted >= max_items_per_producer:
                    logger.warning(
                        "[STREAM] Producer %s hit the %s-item cap — truncating",
                        index,
                        max_items_per_producer,
                    )
                    return
        except BaseException as exc:  # noqa: BLE001 — surfaced as ProducerError
            sink.put((_ERROR, exc))
        finally:
            sink.put((_DONE, None))

    executor = ThreadPoolExecutor(
        max_workers=max(1, max_workers),
        thread_name_prefix=thread_name_prefix,
    )
    try:
        for index, producer in enumerate(producer_list):
            executor.submit(run_producer, index, producer, queues[index])

        for index, sink in enumerate(queues):
            while True:
                if cancelled():
                    return
                try:
                    kind, payload = sink.get(timeout=poll_interval)
                except queue.Empty:
                    continue

                if kind == _ITEM:
                    yield payload
                elif kind == _ERROR:
                    yield ProducerError(index=index, exc=payload)
                else:  # _DONE
                    break
    finally:
        # Tell any still-running producer to give up, and never block the
        # response thread waiting for them.
        stop.set()
        executor.shutdown(wait=False, cancel_futures=True)
