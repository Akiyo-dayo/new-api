"""accounts.json: one NovelAI account per new-api channel, each with its own proxy."""

from __future__ import annotations

import json

import pytest
from novelai_python._exceptions import APIError, AuthError, ConcurrentGenerationError, SessionHttpError

from app import main
from app.accounts import Account, AccountPool, failover_reason, lane
from tests.conftest import png

GEN = "/v1/images/generations"
TOKEN_A = "pst-account-a"
TOKEN_B = "pst-account-b"
PROXY_B = "socks5h://user:s3cret-pw@10.0.0.2:1080"


def body(model: str = "nai-diffusion-4-5-full") -> dict:
    return {"model": model, "prompt": "1girl", "size": "832x1216"}


def auth(token: str = TOKEN_A) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def write(tmp_path, accounts) -> str:
    path = tmp_path / "accounts.json"
    path.write_text(json.dumps({"accounts": accounts}), encoding="utf-8")
    return str(path)


def quota_error() -> AuthError:
    return AuthError("Not enough Anlas. Required: 26, Available: 4", request=None, response=None, code=402)


@pytest.fixture
def pool(monkeypatch):
    accounts = AccountPool(
        [Account(name="A", token=TOKEN_A), Account(name="B", token=TOKEN_B, proxy=PROXY_B, accept_language="ja")]
    )
    monkeypatch.setattr(main, "pool", accounts)
    return accounts


@pytest.fixture
def calls(monkeypatch, recorder):
    """The credential of every NovelAI generation; ``fail`` maps a token to what it raises."""
    used: list = []
    fail: dict[str, BaseException] = {}

    async def fake(gen, credential):
        used.append(credential)
        token = credential.api_token.get_secret_value()
        if token in fail:
            raise fail[token]
        return [("image_0.png", png((8, 8)))]

    monkeypatch.setattr(main, "_generate", fake)
    fake.used, fake.fail = used, fail
    fake.tokens = lambda: [c.api_token.get_secret_value() for c in used]
    return fake


# --------------------------------------------------------------------- loading


def test_missing_file_means_every_key_goes_out_directly(tmp_path):
    pool = AccountPool.load(str(tmp_path / "absent.json"))
    assert not pool.pooled
    account = pool.account_for("pst-anyone")
    assert account.token == "pst-anyone" and account.proxy is None


def test_load_reads_accounts_and_hides_secrets(tmp_path):
    path = write(
        tmp_path,
        [
            {"name": "ch198", "token": TOKEN_A},
            {"name": "ch199", "token": TOKEN_B, "proxy": PROXY_B, "accept_language": "ja"},
        ],
    )
    pool = AccountPool.load(path)
    assert pool.describe() == [
        {"name": "ch198", "egress": "direct"},
        {"name": "ch199", "egress": "socks5h://10.0.0.2:1080"},
    ]
    text = repr(pool.accounts) + json.dumps(pool.describe())
    assert TOKEN_B not in text and "s3cret-pw" not in text
    assert pool.account_for(TOKEN_B).proxy == PROXY_B
    assert pool.account_for("pst-stranger") is None


@pytest.mark.parametrize(
    "accounts, message",
    [
        ([], "no accounts"),
        ([{"name": "A"}], "token is missing"),
        ([{"name": "bad name", "token": "pst-x"}], "name"),
        ([{"name": "A", "token": "pst-x"}, {"name": "A", "token": "pst-y"}], "listed twice"),
        ([{"name": "A", "token": "pst-x"}, {"name": "B", "token": "pst-x"}], "same token"),
        ([{"name": "A", "token": "pst-x", "proxy": "ftp://u:s3cret-pw@h:1"}], "proxy must start with"),
        ([{"name": "A", "token": "pst-x", "proxy": "http://u:s3cret-pw@h"}], "host:port"),
        ([{"name": "A", "token": "pst-x", "proxi": "http://h:1"}], "unknown keys"),
    ],
)
def test_load_rejects_broken_files_without_leaking(tmp_path, accounts, message):
    with pytest.raises(ValueError) as caught:
        AccountPool.load(write(tmp_path, accounts))
    assert message in str(caught.value)
    assert "s3cret-pw" not in str(caught.value) and "pst-x" not in str(caught.value)


def test_unreadable_file_is_an_error(tmp_path):
    path = tmp_path / "accounts.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        AccountPool.load(str(path))


# --------------------------------------------------------------------- credentials


def test_credential_carries_the_accounts_proxy_and_language():
    account = Account(name="B", token=TOKEN_B, proxy=PROXY_B, accept_language="ja")
    kwargs = account.credential().session_kwargs(30, {})
    assert kwargs["proxies"] == {"http": PROXY_B, "https": PROXY_B}
    assert kwargs["trust_env"] is False  # HTTP(S)_PROXY in the environment must not reroute it
    assert kwargs["headers"]["accept-language"].startswith("ja-JP")


def test_direct_account_has_no_proxy():
    assert "proxies" not in Account(name="A", token=TOKEN_A).credential().session_kwargs(30, {})


def test_failover_reasons():
    assert failover_reason(quota_error()) == "quota"
    assert failover_reason(APIError("Anlas", None, None, 402)) == "quota"
    assert failover_reason(ConcurrentGenerationError("busy", None, None, 429)) == "busy"
    assert failover_reason(AuthError("bad token", None, None, 401)) == "auth"
    assert failover_reason(SessionHttpError("proxy refused")) == "network"
    assert failover_reason(AuthError("bad prompt", None, None, 400)) is None
    assert failover_reason(APIError("server error", None, None, 500)) is None
    assert failover_reason(TimeoutError()) is None


def test_lanes_separate_models_and_paid_work():
    assert lane("nai-diffusion-5-full", 0) == "v5:free"
    assert lane("nai-diffusion-5-curated", 26) == "v5:paid"
    assert lane("nai-diffusion-4-5-full", 0) == "v4:free"
    assert lane("nai-diffusion-4-5-full-inpainting", 2) == "v4:paid"


# --------------------------------------------------------------------- requests


async def test_each_key_uses_its_own_account_and_proxy(client, pool, calls):
    assert (await client.post(GEN, json=body(), headers=auth(TOKEN_B))).status_code == 200
    assert (await client.post(GEN, json=body(), headers=auth(TOKEN_A))).status_code == 200
    b, a = calls.used
    assert b.api_token.get_secret_value() == TOKEN_B and b.proxy == PROXY_B and b.accept_language == "ja"
    assert a.api_token.get_secret_value() == TOKEN_A and a.proxy is None


async def test_key_missing_from_the_file_is_refused(client, pool, calls):
    response = await client.post(GEN, json=body(), headers=auth("pst-stranger"))
    assert response.status_code == 401
    assert calls.used == []


async def test_out_of_quota_account_cools_down_for_that_lane_only(client, pool, calls):
    calls.fail[TOKEN_A] = quota_error()
    first = await client.post(GEN, json=body("nai-diffusion-5-full"), headers=auth())
    assert first.status_code == 402
    assert first.json()["error"]["code"] == "insufficient_quota"
    assert calls.tokens() == [TOKEN_A]

    # Answered at once now, NovelAI is not asked again; new-api retries on another channel.
    del calls.fail[TOKEN_A]
    again = await client.post(GEN, json=body("nai-diffusion-5-full"), headers=auth())
    assert again.status_code == 402
    assert int(again.headers["Retry-After"]) > 0
    assert calls.tokens() == [TOKEN_A]

    # Free V4.5 still runs on that account, and the other account is untouched.
    assert (await client.post(GEN, json=body(), headers=auth())).status_code == 200
    assert (await client.post(GEN, json=body("nai-diffusion-5-full"), headers=auth(TOKEN_B))).status_code == 200
    assert calls.tokens() == [TOKEN_A, TOKEN_A, TOKEN_B]


@pytest.mark.parametrize(
    "error, status",
    [
        (AuthError("bad token", request=None, response=None, code=401), 401),
        (ConcurrentGenerationError("busy", request=None, response=None, code=429), 429),
        (SessionHttpError("proxy refused"), 502),
    ],
)
async def test_other_refusals_cool_the_whole_account(client, pool, calls, error, status):
    calls.fail[TOKEN_A] = error
    assert (await client.post(GEN, json=body(), headers=auth())).status_code == status
    del calls.fail[TOKEN_A]
    for model in ("nai-diffusion-4-5-full", "nai-diffusion-5-full"):
        response = await client.post(GEN, json=body(model), headers=auth())
        assert response.status_code == status
        assert "Retry-After" in response.headers
    assert calls.tokens() == [TOKEN_A]


async def test_bad_request_cools_nothing(client, pool, calls):
    calls.fail[TOKEN_A] = AuthError("prompt rejected", request=None, response=None, code=400)
    assert (await client.post(GEN, json=body(), headers=auth())).status_code == 400
    del calls.fail[TOKEN_A]
    assert (await client.post(GEN, json=body(), headers=auth())).status_code == 200
    assert calls.tokens() == [TOKEN_A, TOKEN_A]


async def test_errors_never_leak_the_proxy_password(client, pool, calls):
    calls.fail[TOKEN_B] = SessionHttpError(f"could not connect through {PROXY_B}")
    response = await client.post(GEN, json=body(), headers=auth(TOKEN_B))
    assert response.status_code == 502
    assert "s3cret-pw" not in response.text and TOKEN_B not in response.text


async def test_without_a_file_the_key_is_the_account(client, calls):
    response = await client.post(GEN, json=body(), headers=auth("pst-anyone"))
    assert response.status_code == 200
    assert calls.tokens() == ["pst-anyone"]
    assert calls.used[0].proxy is None
