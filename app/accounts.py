"""NovelAI accounts and their proxies.

Each NovelAI account is its own channel in new-api, so new-api's per-channel numbers are the
per-account numbers. The key new-api sends picks the account; ``accounts.json`` says which
proxy that account leaves through, so no two accounts need to share an address. A key that is
not in the file is refused: an account must never slip out through this machine's address
because it was forgotten in the file.

An account NovelAI turned away (out of Anlas, bad token, busy elsewhere, proxy down) cools
down for a while: its requests are answered at once without contacting NovelAI, with a status
new-api retries on another channel.

The SDK never reads HTTP(S)_PROXY from the environment (``trust_env=False``): the proxy has to
travel inside the credential, which is built here for the generation, the vibe encode and the
status check alike.

Without the file every key is its own account and goes out directly, as before.
"""

from __future__ import annotations

import json
import math
import os
import re
import secrets
import time
from dataclasses import dataclass, field

from novelai_python._exceptions import APIError, AuthError, ConcurrentGenerationError, SessionHttpError
from novelai_python.credential import ApiCredential
from pydantic import SecretStr

from .config import describe_proxy, settings
from .queue import token_key

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
ALL_LANES = "*"


@dataclass(eq=False)
class Account:
    name: str
    token: str = field(repr=False)
    proxy: str | None = field(default=None, repr=False)
    accept_language: str | None = None
    key: str = field(init=False, repr=False)
    egress: str = field(init=False)

    def __post_init__(self) -> None:
        self.key = token_key(self.token)
        self.egress = describe_proxy(self.proxy) if self.proxy else "direct"

    def credential(self) -> ApiCredential:
        return ApiCredential(api_token=SecretStr(self.token), proxy=self.proxy, accept_language=self.accept_language)


def lane(model: str, estimate: int) -> str:
    """What a quota cooldown blocks. Running out of Anlas only stops paid work: an Opus
    account whose V5 bar is empty still makes free V4.5 images, so V5 and V4.5 and free and
    paid requests cool down separately."""
    family = "v5" if "diffusion-5" in model else "v4"
    return f"{family}:{'paid' if estimate > 0 else 'free'}"


def failover_reason(exc: BaseException) -> str | None:
    """Why this account cannot take requests for a while although another account might;
    None when any account would fail the same way (a bad request, a timeout)."""
    if isinstance(exc, ConcurrentGenerationError):
        return "busy"
    if isinstance(exc, APIError):
        code = str(exc.code) if exc.code is not None else ""
        if code == "402":
            return "quota"
        if code == "429":
            return "busy"
        if isinstance(exc, AuthError) and code != "400":
            return "auth"
        return None
    if isinstance(exc, SessionHttpError):
        return "network"
    return None


class AccountPool:
    def __init__(self, accounts: list[Account] | None) -> None:
        if accounts is not None and not accounts:
            raise ValueError("accounts file lists no accounts")
        self.accounts = accounts
        # (account key, lane) -> (reason, monotonic time the cooldown ends)
        self._cooling: dict[tuple[str, str], tuple[str, float]] = {}

    @classmethod
    def load(cls, path: str) -> AccountPool:
        """The accounts in ``path``, or no pool when the file does not exist. Anything wrong
        with the file raises ``ValueError``: the service must not start on a half-read file.
        The messages name the entry, never a token or a proxy (they may carry passwords)."""
        if not os.path.exists(path):
            return cls(None)
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise ValueError(f"cannot read accounts file {path}: {type(exc).__name__}") from None
        entries = data.get("accounts") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            raise ValueError('accounts file must look like {"accounts": [...]}')
        accounts: list[Account] = []
        for index, entry in enumerate(entries):
            where = f"accounts[{index}]"
            if not isinstance(entry, dict):
                raise ValueError(f"{where} must be an object")
            unknown = set(entry) - {"name", "token", "proxy", "accept_language"}
            if unknown:
                raise ValueError(f"{where} has unknown keys {sorted(unknown)}")
            name, token = entry.get("name"), entry.get("token")
            proxy, language = entry.get("proxy") or None, entry.get("accept_language") or None
            if not isinstance(name, str) or not NAME_RE.match(name):
                raise ValueError(f"{where}.name must be 1-32 letters, digits, - or _")
            where = f"account {name}"
            if not isinstance(token, str) or not token.strip():
                raise ValueError(f"{where}: token is missing")
            if proxy is not None and not isinstance(proxy, str):
                raise ValueError(f"{where}: proxy must be a string")
            if language is not None and not isinstance(language, str):
                raise ValueError(f"{where}: accept_language must be a string")
            try:
                account = Account(name=name, token=token.strip(), proxy=proxy, accept_language=language)
            except ValueError as exc:
                raise ValueError(f"{where}: {exc}") from None
            if any(a.name == name for a in accounts):
                raise ValueError(f"{where} is listed twice")
            if any(a.key == account.key for a in accounts):
                raise ValueError(f"{where} has the same token as another account")
            accounts.append(account)
        return cls(accounts)

    @property
    def pooled(self) -> bool:
        return self.accounts is not None

    def account_for(self, bearer: str) -> Account | None:
        """The account behind the key new-api sent: the entry with that token, or without a
        file the key itself, going out directly. None = the key is not in the file."""
        if self.accounts is None:
            return Account(name="default", token=bearer)
        found = None
        for account in self.accounts:
            if secrets.compare_digest(account.token.encode(), bearer.encode()):
                found = account
        return found

    def cool(self, account: Account, reason: str, lane_: str) -> float:
        """Answer the account's requests without contacting NovelAI for a while; returns the
        seconds. Only a quota cooldown is limited to one lane."""
        seconds = {
            "quota": settings.cooldown_quota_seconds,
            "auth": settings.cooldown_auth_seconds,
            "busy": settings.cooldown_busy_seconds,
            "network": settings.cooldown_network_seconds,
        }[reason]
        target = lane_ if reason == "quota" else ALL_LANES
        self._cooling[(account.key, target)] = (reason, time.monotonic() + seconds)
        return seconds

    def cooling(self, account: Account, lane_: str) -> tuple[str, int] | None:
        """``(reason, seconds left)`` while the account is cooling down for this lane."""
        now = time.monotonic()
        for target in (lane_, ALL_LANES):
            entry = self._cooling.get((account.key, target))
            if entry is None:
                continue
            reason, until = entry
            if until <= now:
                del self._cooling[(account.key, target)]
                continue
            return reason, max(1, math.ceil(until - now))
        return None

    def describe(self) -> list[dict[str, str]]:
        """Name and exit of every account, for the startup log; no secrets."""
        return [{"name": a.name, "egress": a.egress} for a in self.accounts or []]
