"""Account check, run inside the adapter container::

    docker exec nai-adapter python -m app.status

One JSON line per account of the pool: where its NovelAI traffic leaves (the exit address as
an outside service sees it, through the account's own proxy and browser profile) and its
subscription: tier, expiry, Anlas and the Opus V5 usage bar. Without a pool, pass the token on
stdin instead (``printf %s "$TOKEN" | docker exec -i nai-adapter python -m app.status``).
Tokens and proxy passwords are never printed, and the token only ever goes to NovelAI.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from typing import Any

from curl_cffi.requests import AsyncSession
from novelai_python.sdk.user.subscription import Subscription

from .accounts import Account, AccountPool
from .config import settings
from .errors import scrub

IP_ECHO = "https://ipinfo.io/json"
# Web client constant: about 17.3 default-settings V5 images per 1 % of the bar.
IMAGES_PER_PERCENT = 17.3


def _clean(exc: BaseException, account: Account) -> str:
    text = scrub(f"{type(exc).__name__}: {exc}", account.token, account.proxy)
    return re.sub(r"[^\s/@:]+:[^\s/@]+@", "***@", text)[:300]


async def exit_address(account: Account) -> dict[str, Any]:
    # Same proxy and browser profile, but WITHOUT the Authorization header: the IP echo
    # service must never see the NovelAI token.
    kwargs = account.credential().session_kwargs(20, {})
    try:
        async with AsyncSession(**kwargs) as session:
            response = await session.get(IP_ECHO)
            data = response.json()
        return {key: data.get(key) for key in ("ip", "country", "city", "org")}
    except Exception as exc:  # noqa: BLE001 - reported, not raised: the account check still runs
        return {"error": _clean(exc, account)}


async def subscription(account: Account) -> dict[str, Any]:
    try:
        sub = await Subscription().request(session=account.credential())
    except Exception as exc:  # noqa: BLE001
        return {"error": _clean(exc, account)}
    out: dict[str, Any] = {
        "tier": sub.tier_name,
        "active": sub.active,
        "expires": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(sub.expiresAt)),
        "anlas": sub.trainingStepsLeft.fixedTrainingStepsLeft + sub.trainingStepsLeft.purchasedTrainingSteps,
    }
    usage = sub.usage
    if usage is None:
        out["bar"] = None
        return out
    per_day = usage.refill_percent_per_day
    out.update(
        {
            "bar_percent": usage.percent,
            "bar_negative": usage.isNegative,
            "v5_free_images_left": usage.images_left_estimate,
            "v5_free_images_per_day": round(per_day * IMAGES_PER_PERCENT) if per_day else None,
        }
    )
    return out


async def check(account: Account) -> dict[str, Any]:
    exit_info, sub_info = await asyncio.gather(exit_address(account), subscription(account))
    return {"account": account.name, "egress": account.egress, "exit": exit_info, **sub_info}


async def main() -> int:
    try:
        pool = AccountPool.load(settings.accounts_file)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 2
    if pool.accounts is not None:
        accounts = pool.accounts
    else:
        token = sys.stdin.read().strip()
        if not token:
            print(json.dumps({"error": f"no {settings.accounts_file} and no token on stdin"}))
            return 2
        accounts = [Account(name="default", token=token)]
    # One account at a time: each check is a separate client, there is no hurry.
    failed = 0
    for account in accounts:
        result = await check(account)
        failed += "error" in result
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
