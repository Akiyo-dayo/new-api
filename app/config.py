"""Runtime configuration.

Everything is read from the environment once at import time and every value has a
default, so the service starts without any configuration at all.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or not value.strip() else value.strip()


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "y"}


@dataclass
class Settings:
    max_n: int = 4
    max_steps: int = 50
    max_vibes: int = 4
    max_char_refs: int = 1
    max_image_bytes: int = 10_485_760
    max_pixels: int = 1_048_576
    # 0 admits only free requests; a negative value turns the ceiling off.
    max_anlas_per_request: int = 0
    nai_opus: bool = True
    vibe_encode_anlas: int = 2
    vibe_cache_dir: str = "/data/vibe-cache"
    vibe_cache_max: int = 500
    max_queue: int = 8
    queue_timeout_seconds: float = 120.0
    # A request is turned away up front when the queue ahead of it is expected to take
    # longer than this, so callers get a quick 429 instead of hanging until their own timeout.
    max_wait_seconds: float = 60.0
    nai_timeout_seconds: float = 120.0
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            max_n=_int("MAX_N", 4),
            max_steps=_int("MAX_STEPS", 50),
            max_vibes=_int("MAX_VIBES", 4),
            max_char_refs=_int("MAX_CHAR_REFS", 1),
            max_image_bytes=_int("MAX_IMAGE_BYTES", 10_485_760),
            max_pixels=_int("MAX_PIXELS", 1_048_576),
            max_anlas_per_request=_int("MAX_ANLAS_PER_REQUEST", 0),
            nai_opus=_bool("NAI_OPUS", True),
            vibe_encode_anlas=_int("VIBE_ENCODE_ANLAS", 2),
            vibe_cache_dir=_str("VIBE_CACHE_DIR", "/data/vibe-cache"),
            vibe_cache_max=_int("VIBE_CACHE_MAX", 500),
            max_queue=_int("MAX_QUEUE", 8),
            queue_timeout_seconds=_float("QUEUE_TIMEOUT_SECONDS", 120.0),
            max_wait_seconds=_float("MAX_WAIT_SECONDS", 60.0),
            nai_timeout_seconds=_float("NAI_TIMEOUT_SECONDS", 120.0),
            log_level=_str("LOG_LEVEL", "INFO"),
        )


settings = Settings.from_env()
