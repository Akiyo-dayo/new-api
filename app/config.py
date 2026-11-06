"""Runtime configuration.

Everything is read from the environment once at import time and every value has a
default, so the service starts without any configuration at all.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

# What curl (inside curl_cffi) can tunnel through. socks5h resolves names at the proxy.
PROXY_SCHEMES = ("http", "https", "socks4", "socks4a", "socks5", "socks5h")


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
    # Per image: a request for n images may cost up to n times this. 0 admits only free
    # images; a negative value turns the ceiling off.
    max_anlas_per_image: int = 0
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
    # The account pool (tokens, proxies). Missing file = no pool: the caller's bearer token is
    # used directly, straight from this machine, as before the pool existed.
    accounts_file: str = "/data/accounts.json"
    # How long an account is skipped after NovelAI turned it down, by reason.
    cooldown_quota_seconds: float = 1800.0
    cooldown_auth_seconds: float = 1800.0
    cooldown_busy_seconds: float = 60.0
    cooldown_network_seconds: float = 120.0

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            max_n=_int("MAX_N", 4),
            max_steps=_int("MAX_STEPS", 50),
            max_vibes=_int("MAX_VIBES", 4),
            max_char_refs=_int("MAX_CHAR_REFS", 1),
            max_image_bytes=_int("MAX_IMAGE_BYTES", 10_485_760),
            max_pixels=_int("MAX_PIXELS", 1_048_576),
            # MAX_ANLAS_PER_REQUEST is the name used before multi-image requests were split.
            max_anlas_per_image=_int("MAX_ANLAS_PER_IMAGE", _int("MAX_ANLAS_PER_REQUEST", 0)),
            nai_opus=_bool("NAI_OPUS", True),
            vibe_encode_anlas=_int("VIBE_ENCODE_ANLAS", 2),
            vibe_cache_dir=_str("VIBE_CACHE_DIR", "/data/vibe-cache"),
            vibe_cache_max=_int("VIBE_CACHE_MAX", 500),
            max_queue=_int("MAX_QUEUE", 8),
            queue_timeout_seconds=_float("QUEUE_TIMEOUT_SECONDS", 120.0),
            max_wait_seconds=_float("MAX_WAIT_SECONDS", 60.0),
            nai_timeout_seconds=_float("NAI_TIMEOUT_SECONDS", 120.0),
            log_level=_str("LOG_LEVEL", "INFO"),
            accounts_file=_str("NAI_ACCOUNTS_FILE", "/data/accounts.json"),
            cooldown_quota_seconds=_float("COOLDOWN_QUOTA_SECONDS", 1800.0),
            cooldown_auth_seconds=_float("COOLDOWN_AUTH_SECONDS", 1800.0),
            cooldown_busy_seconds=_float("COOLDOWN_BUSY_SECONDS", 60.0),
            cooldown_network_seconds=_float("COOLDOWN_NETWORK_SECONDS", 120.0),
        )


def describe_proxy(url: str) -> str:
    """``scheme://host:port`` of the proxy, without credentials, for logs.

    Raises ``ValueError`` when the URL cannot work. The messages never repeat the URL: it
    may carry a password.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in PROXY_SCHEMES:
        raise ValueError(f"proxy must start with one of {', '.join(s + '://' for s in PROXY_SCHEMES)}")
    try:
        port = parts.port
    except ValueError:
        raise ValueError("proxy has an invalid port") from None
    if not parts.hostname or port is None:
        raise ValueError("proxy must look like scheme://[user:password@]host:port")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ValueError("proxy must not have a path, query or fragment")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    return f"{scheme}://{host}:{port}"


settings = Settings.from_env()
