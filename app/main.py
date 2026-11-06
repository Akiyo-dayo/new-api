"""FastAPI application: OpenAI image API in front of NovelAI."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from novelai_python._exceptions import NovelAiError
from novelai_python.credential import ApiCredential

from .accounts import AccountPool, failover_reason, lane
from .build import VibeCache, build_request, encode_vibes, missing_vibe_keys
from .config import settings
from .errors import (
    ClientGone,
    OpenAIError,
    account_cooling,
    anlas_limit,
    anlas_unavailable,
    bad_request,
    map_sdk_error,
    payload_too_large,
    unauthorized,
)
from .images import as_png_rgb
from .parse import MODEL_WHITELIST, ImageJob, parse_json_body, parse_multipart
from .queue import TokenQueues

MAX_BODY_BYTES = 40 * 1024 * 1024
# The SDK accepts seeds 1..2**32-8; per-image seeds wrap around inside that range.
SEED_MAX = 4294967288

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("nai_adapter")

# Read at import: a broken accounts file (or proxy in it) stops the service instead of
# letting an account fall back to this machine's address.
pool = AccountPool.load(settings.accounts_file)

queues = TokenQueues(
    max_queue=settings.max_queue,
    timeout=settings.queue_timeout_seconds,
    max_wait=settings.max_wait_seconds,
)
vibe_cache = VibeCache(settings.vibe_cache_dir, settings.vibe_cache_max)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        json.dumps(
            {
                "event": "startup",
                "max_queue": settings.max_queue,
                "single_worker": True,
                "accounts": pool.describe() if pool.pooled else "no pool: bearer token, direct",
            },
            ensure_ascii=False,
        )
    )
    yield
    logger.info(json.dumps({"event": "shutdown"}))


app = FastAPI(
    title="nai-adapter",
    lifespan=lifespan,
    # Only the three documented routes exist; every other path is a 404 in the OpenAI shape.
    # Without this a trailing slash would answer with a redirect instead of a 404.
    redirect_slashes=False,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# --------------------------------------------------------------------------- error handling


@app.exception_handler(OpenAIError)
async def _openai_error_handler(_request: Request, exc: OpenAIError) -> JSONResponse:
    return _error_response(exc)


def _error_response(exc: OpenAIError) -> JSONResponse:
    return JSONResponse(exc.payload(), status_code=exc.status, headers=exc.headers)


@app.exception_handler(StarletteHTTPException)
async def _http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Not Found"
    if exc.status_code == 404:
        message = (
            "本渠道只提供图片接口 /v1/images/generations 和 /v1/images/edits"
            " / Only the image endpoints are available on this channel"
        )
    error = OpenAIError(exc.status_code, message, code="not_found" if exc.status_code == 404 else "http_error")
    return JSONResponse(error.payload(), status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    error = bad_request(f"Invalid request: {exc.errors()}")
    return JSONResponse(error.payload(), status_code=400)


@app.exception_handler(Exception)
async def _unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error: %s", type(exc).__name__)
    error = OpenAIError(500, "internal error", code="internal_error")
    return JSONResponse(error.payload(), status_code=500)


# --------------------------------------------------------------------------- routes


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    """The model list new-api fetches when a channel is edited; it reveals nothing private."""
    return {
        "object": "list",
        "data": [{"id": name, "object": "model", "created": 0, "owned_by": "novelai"} for name in sorted(MODEL_WHITELIST)],
    }


@app.post("/v1/images/generations")
async def generations(request: Request) -> JSONResponse:
    return await _handle(request, "generations")


@app.post("/v1/images/edits")
async def edits(request: Request) -> JSONResponse:
    return await _handle(request, "edits")


# --------------------------------------------------------------------------- request pipeline


async def _handle(request: Request, route: str) -> JSONResponse:
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = _bearer(request)
    job: ImageJob | None = None
    status = 500
    estimate: int | None = None
    queue_ms = 0.0
    nai_ms = 0.0
    data: list[dict[str, str]] = []
    account_name: str | None = None
    # Everything that must never show up in an error message.
    hidden: list[str | None] = [token]

    try:
        if token is None:
            raise unauthorized()
        account = pool.account_for(token)
        if account is None:
            # Refused rather than sent out directly: a key missing from accounts.json would
            # otherwise put that account on this machine's address.
            raise OpenAIError(
                401, "This key is not in the adapter's accounts.json / 该密钥未登记在适配器的账号文件里", code="invalid_api_key"
            )
        account_name = account.name
        hidden += [account.token, account.proxy]
        job = await _parse_request(request)
        image_png = as_png_rgb(job.image, job.size) if job.image is not None else None

        # Priced before the queue is even entered: a request over the limit must not cause
        # any NovelAI traffic at all, not even a wait for the token lock.
        priced = _build(job, image_bytes=image_png)
        estimate = _estimate_anlas(job, priced)

        # A recent refusal is answered at once, without asking NovelAI again; new-api retries
        # the request on another channel, i.e. another account.
        job_lane = lane(job.model, estimate)
        cooling = pool.cooling(account, job_lane)
        if cooling is not None:
            raise account_cooling(*cooling)

        # new-api cancels its upstream request when the end user goes away, so a caller that
        # gives up while queued is seen here and dropped before it costs a generation.
        queue_ms = await queues.acquire(account.key, is_gone=request.is_disconnected, images=job.n)
        try:
            if await request.is_disconnected():
                raise ClientGone()
            credential = account.credential()
            nai_started = time.perf_counter()
            try:
                encoded = await encode_vibes(job.vibes, job.model, credential, vibe_cache) if job.vibes else None
                files = await _generate_all(request, job, encoded, image_png, credential, account.key)
            finally:
                # Also recorded when NovelAI fails: the log then shows how long it burned.
                nai_ms = (time.perf_counter() - nai_started) * 1000.0
        except NovelAiError as exc:
            # Out of Anlas, bad token, busy elsewhere, proxy down: skip this account for a
            # while. A bad request would fail on any account and cools nothing.
            reason = failover_reason(exc)
            if reason is not None:
                seconds = pool.cool(account, reason, job_lane)
                logger.warning(
                    json.dumps(
                        {
                            "event": "cooldown",
                            "request_id": request_id,
                            "account": account.name,
                            "reason": reason,
                            "lane": job_lane if reason == "quota" else "*",
                            "seconds": seconds,
                        }
                    )
                )
            raise
        finally:
            queues.release(account.key)

        data = [{"b64_json": base64.b64encode(payload).decode("ascii")} for _name, payload in files]
        if not data:
            raise OpenAIError(502, "NovelAI returned no images", code="upstream_error")
        status = 200
        body = JSONResponse({"created": int(time.time()), "data": data})
        body.headers["X-NAI-Anlas-Estimate"] = str(estimate)
        return body

    except OpenAIError as exc:
        status = exc.status
        return _error_response(exc)
    except ClientGone:
        # Nobody reads this response; 499 only marks the log line.
        status = 499
        return JSONResponse(
            {"error": {"message": "client disconnected", "type": "client_error", "code": "client_gone"}},
            status_code=499,
        )
    except NovelAiError as exc:
        error = map_sdk_error(exc, *hidden)
        status = error.status
        return _error_response(error)
    except TimeoutError:
        error = map_sdk_error(TimeoutError(), *hidden)
        status = 504
        return _error_response(error)
    except Exception as exc:  # noqa: BLE001 - the message never reaches the client
        logger.exception("request %s failed: %s", request_id, type(exc).__name__)
        status = 500
        return JSONResponse(
            {"error": {"message": "internal error", "type": "server_error", "code": "internal_error"}},
            status_code=500,
        )
    finally:
        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "route": route,
                    "model": job.model if job else None,
                    "action": job.action if job else None,
                    "size": f"{job.size[0]}x{job.size[1]}" if job else None,
                    "steps": job.steps if job else None,
                    "n": job.n if job else None,
                    "images": len(data) if data else 0,
                    "vibes": len(job.vibes) if job else 0,
                    "char_refs": len(job.character_references) if job else 0,
                    "anlas": estimate,
                    "account": account_name,
                    "queue_ms": round(queue_ms),
                    "nai_ms": round(nai_ms),
                    "status": status,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000.0),
                },
                ensure_ascii=False,
            )
        )


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


async def _parse_request(request: Request) -> ImageJob:
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    raw = await _read_body(request)

    if content_type in ("", "application/json") or content_type.endswith("+json"):
        try:
            payload = json.loads(raw or b"{}")
        except ValueError as exc:
            raise bad_request("Request body is not valid JSON") from exc
        return parse_json_body(payload, settings)

    if content_type == "multipart/form-data":
        return await _parse_multipart(request, raw)

    raise bad_request(f"Unsupported Content-Type {content_type!r}; use application/json or multipart/form-data")


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                raise payload_too_large(f"Request body exceeds {MAX_BODY_BYTES} bytes")
        except ValueError:
            raise bad_request("Invalid Content-Length header")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks += chunk
        if len(chunks) > MAX_BODY_BYTES:
            raise payload_too_large(f"Request body exceeds {MAX_BODY_BYTES} bytes")
    body = bytes(chunks)
    # Starlette parses a form from this cached body, which keeps the size check above
    # authoritative also for chunked uploads without Content-Length.
    request._body = body  # noqa: SLF001
    return body


async def _parse_multipart(request: Request, raw: bytes) -> ImageJob:
    if not raw:
        raise bad_request("Empty multipart body")
    items: list[tuple[str, str | bytes]] = []
    form = None
    try:
        form = await request.form()
        for key, value in form.multi_items():
            if hasattr(value, "read"):
                data = await value.read()
                if len(data) > settings.max_image_bytes:
                    raise payload_too_large(f"{key} is larger than MAX_IMAGE_BYTES={settings.max_image_bytes}")
                items.append((key, data))
            else:
                items.append((key, str(value)))
    except (ValueError, RuntimeError) as exc:
        # A malformed boundary or a truncated body: the client's fault, not ours.
        raise bad_request(f"Could not parse multipart body: {exc}") from exc
    finally:
        if form is not None:
            await form.close()  # releases the SpooledTemporaryFile of every upload
    return parse_multipart(items, settings)


def _build(
    job: ImageJob,
    vibes: list[str] | None = None,
    image_bytes: bytes | None = None,
    seed: int | None = None,
) -> Any:
    """Build the SDK request in one place so tests can capture it."""
    return build_request(job, vibes=vibes, image_bytes=image_bytes, seed=seed)


def _estimate_anlas(job: ImageJob, gen: Any) -> int:
    """Anlas this request will cost: ``gen`` (one image) times n, plus the vibe encodes that
    are not cached yet. The ceiling is per image, so it scales with n too.

    Runs before the token lock, so an over-limit request never touches NovelAI. A cost the
    SDK refuses to compute is a rejection too: spending blind is worse than a 400.
    """
    try:
        base = gen.calculate_cost(is_opus=settings.nai_opus)
    except Exception as exc:  # noqa: BLE001 - the SDK raises ValueError for anything it cannot price
        raise anlas_unavailable(str(exc) or type(exc).__name__) from exc
    if isinstance(base, bool) or not isinstance(base, (int, float)):
        raise anlas_unavailable(f"unexpected cost {base!r}")
    cost = int(base)
    if cost < 0:
        # -3: one image alone would cost more than NovelAI's own per-image cap.
        raise OpenAIError(
            400,
            "NovelAI prices this request above its per-image Anlas cap",
            code="anlas_limit",
        )
    total = cost * job.n + len(missing_vibe_keys(job.vibes, job.model, vibe_cache)) * settings.vibe_encode_anlas
    # 0 admits only free images; a negative value turns the ceiling off.
    limit = settings.max_anlas_per_image * job.n
    if settings.max_anlas_per_image >= 0 and total > limit:
        raise anlas_limit(total, limit)
    return total


async def _generate_all(
    request: Request,
    job: ImageJob,
    vibes: list[str] | None,
    image_png: bytes | None,
    credential: ApiCredential,
    key: str,
) -> list[tuple[str, bytes]]:
    """One NovelAI call per image, seeds counting up from the request's seed.

    new-api bills by the number of images returned, so a failure after the first image
    keeps what was made instead of throwing it away; a caller that left stops the batch.
    """
    base_seed = job.seed if job.seed is not None else secrets.randbelow(SEED_MAX) + 1
    files: list[tuple[str, bytes]] = []
    for index in range(job.n):
        if index and await request.is_disconnected():
            break
        gen = _build(job, vibes, image_png, seed=(base_seed - 1 + index) % SEED_MAX + 1)
        started = time.perf_counter()
        try:
            produced = await _generate(gen, credential)
        except (NovelAiError, TimeoutError) as exc:
            if not files:
                raise
            logger.warning("image %d of %d failed (%s); returning %d", index + 1, job.n, type(exc).__name__, len(files))
            break
        queues.record(key, time.perf_counter() - started)
        files.extend(produced[:1])
    return files


async def _generate(gen: Any, credential: ApiCredential) -> list[tuple[str, bytes]]:
    response = await asyncio.wait_for(
        gen.request(session=credential),
        timeout=settings.nai_timeout_seconds,
    )
    return list(response.files or [])
