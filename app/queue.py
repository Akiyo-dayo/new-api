"""Per-token serialisation of NovelAI calls.

NovelAI allows one generation per account at a time, so every request holding the
same token waits for the previous one. The lock lives in this process, which is why
the service must run with a single worker.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from .errors import ClientGone, queue_full, queue_timeout

# How often a waiting request checks whether its caller is still connected.
_POLL_SECONDS = 1.0
# Weight of the newest generation in the running average.
_AVG_WEIGHT = 0.3


def token_key(token: str) -> str:
    """Stable key for the lock table; the token itself is never stored or logged."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class _Slot:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    waiting: int = 0
    """Requests blocked on ``lock`` right now; the one holding it is not counted."""
    waiting_images: int = 0
    """Images those waiting requests will generate."""
    running_images: int = 0
    """Images the request holding the lock generates."""
    avg_seconds: float | None = None
    """Running average of how long one image takes."""


class TokenQueues:
    def __init__(
        self,
        max_queue: int,
        timeout: float,
        *,
        max_wait: float = 0.0,
        default_seconds: float = 10.0,
    ) -> None:
        self.max_queue = max_queue
        self.timeout = timeout
        self.max_wait = max_wait
        self.default_seconds = default_seconds
        self._slots: dict[str, _Slot] = {}

    def _slot(self, key: str) -> _Slot:
        slot = self._slots.get(key)
        if slot is None:
            slot = _Slot()
            self._slots[key] = slot
        return slot

    def _per_image(self, slot: _Slot) -> float:
        return slot.avg_seconds if slot.avg_seconds is not None else self.default_seconds

    async def acquire(
        self,
        key: str,
        is_gone: Callable[[], Awaitable[bool]] | None = None,
        *,
        images: int = 1,
    ) -> float:
        """Wait for the token's turn; returns the wait in milliseconds.

        A busy token turns a request away with a 429 when ``max_queue`` requests already
        wait, or when the images queued ahead of it (the running request's plus every
        waiter's) are expected to take longer than ``max_wait``. A request that is admitted
        but still waits past ``timeout`` gets a 429 too. ``is_gone`` is polled while waiting:
        a caller that disconnected leaves the queue with ``ClientGone`` and never reaches
        NovelAI. A free token always accepts the request, so ``max_queue=0`` means "never queue".
        """
        slot = self._slot(key)
        if slot.lock.locked():
            per_image = self._per_image(slot)
            ahead = max(1, slot.running_images) + slot.waiting_images
            retry_after = max(1, math.ceil(per_image * max(1, slot.running_images)))
            if slot.waiting >= self.max_queue:
                raise queue_full(retry_after)
            if self.max_wait > 0 and ahead * per_image > self.max_wait:
                raise queue_full(retry_after)

        slot.waiting += 1
        slot.waiting_images += images
        loop = asyncio.get_running_loop()
        started = loop.time()
        deadline = started + self.timeout
        acquired = False
        attempt = asyncio.ensure_future(slot.lock.acquire())
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise queue_timeout(self.timeout)
                done, _ = await asyncio.wait({attempt}, timeout=min(remaining, _POLL_SECONDS))
                if attempt in done:
                    attempt.result()
                    acquired = True
                    slot.running_images = images
                    return (loop.time() - started) * 1000.0
                if is_gone is not None and await is_gone():
                    raise ClientGone()
        finally:
            slot.waiting -= 1
            slot.waiting_images -= images
            if not acquired:
                if not attempt.done():
                    attempt.cancel()
                    try:
                        await attempt
                    except asyncio.CancelledError:
                        pass
                # The lock may have been granted in the instant before the cancel landed.
                if attempt.done() and not attempt.cancelled() and attempt.exception() is None:
                    slot.lock.release()

    def record(self, key: str, seconds: float) -> None:
        """Feed one image's generation time into the token's running average."""
        slot = self._slots.get(key)
        if slot is None or seconds <= 0:
            return
        if slot.avg_seconds is None:
            slot.avg_seconds = seconds
        else:
            slot.avg_seconds = (1 - _AVG_WEIGHT) * slot.avg_seconds + _AVG_WEIGHT * seconds

    def release(self, key: str) -> None:
        # Slots are kept after release: there is one per channel token, a handful at most,
        # and keeping them keeps the running average across quiet spells.
        slot = self._slots.get(key)
        if slot is not None and slot.lock.locked():
            slot.running_images = 0
            slot.lock.release()
