"""OpenAI-style errors and the mapping from NovelAI SDK exceptions."""

from __future__ import annotations

from typing import Any

from novelai_python._exceptions import (
    APIError,
    AuthError,
    ConcurrentGenerationError,
    DataSerializationError,
    SessionHttpError,
)


class OpenAIError(Exception):
    """An error that is returned to the caller in the OpenAI error envelope."""

    def __init__(
        self,
        status: int,
        message: str,
        *,
        code: str = "invalid_request",
        type: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.type = type or _default_type(status)
        self.headers = headers

    def payload(self) -> dict[str, Any]:
        return {"error": {"message": self.message, "type": self.type, "code": self.code}}


def _default_type(status: int) -> str:
    if status in (400, 404, 405, 413):
        return "invalid_request_error"
    if status == 401:
        return "authentication_error"
    if status == 402:
        return "insufficient_quota"
    if status == 429:
        return "rate_limit_error"
    return "server_error"


def bad_request(message: str, *, code: str = "invalid_request") -> OpenAIError:
    return OpenAIError(400, message, code=code)


def unauthorized(message: str = "Missing NovelAI API token") -> OpenAIError:
    return OpenAIError(401, message, code="missing_api_key")


def payload_too_large(message: str) -> OpenAIError:
    return OpenAIError(413, message, code="request_too_large")


def queue_full(retry_after: int) -> OpenAIError:
    return OpenAIError(
        429,
        f"当前排队人数较多，请约 {retry_after} 秒后重试 / Too many requests queued, retry in about {retry_after}s",
        code="queue_full",
        headers={"Retry-After": str(retry_after)},
    )


def queue_timeout(seconds: float) -> OpenAIError:
    return OpenAIError(
        429,
        f"排队等待超过 {seconds:g} 秒，请稍后重试 / Timed out after {seconds:g}s waiting in the queue",
        code="queue_timeout",
        headers={"Retry-After": "10"},
    )


class ClientGone(Exception):
    """The caller disconnected while its request was still queued; nothing was sent to NovelAI."""


def anlas_limit(estimated: int, limit: int) -> OpenAIError:
    return OpenAIError(
        400,
        f"该请求预计消耗 {estimated} Anlas，超出本站上限 {limit}，请减少步数、尺寸或张数"
        f" / Estimated cost {estimated} Anlas exceeds the limit of {limit}",
        code="anlas_limit",
    )


def anlas_unavailable(reason: str) -> OpenAIError:
    return OpenAIError(
        400,
        f"Cannot estimate the Anlas cost ({reason}), request refused",
        code="anlas_limit",
    )


def scrub(text: str, token: str | None) -> str:
    """Never let the channel token leak into a message."""
    if not token:
        return text
    return text.replace(token, "***").replace(f"Bearer {token}", "Bearer ***")


def map_sdk_error(exc: BaseException, token: str | None) -> OpenAIError:
    """Translate an SDK exception into the OpenAI error envelope.

    The SDK reports 400 and 402 as ``AuthError`` (see ``ApiBaseModel._raise_for_status``), so
    the status code is inspected before the class: "not enough Anlas" must not look like a
    bad token, or new-api would disable a perfectly healthy channel.
    """
    if isinstance(exc, AuthError):
        code = _code(exc)
        if code == 402:
            return OpenAIError(
                402,
                scrub(f"本站 NovelAI 额度暂时用完，请稍后再试 / NovelAI quota exhausted: {exc.message}", token),
                code="insufficient_quota",
            )
        if code == 400:
            # GenerateImageInfer still sets _legacy_400_as_auth: a validation error arrives here.
            return OpenAIError(400, scrub(f"NovelAI rejected the request: {exc.message}", token), code="novelai_error")
        return OpenAIError(401, scrub(f"NovelAI rejected the token: {exc.message}", token), code="invalid_api_key")
    if isinstance(exc, ConcurrentGenerationError):
        return OpenAIError(
            429,
            scrub(f"NovelAI 账号正忙，请稍后重试 / NovelAI is already generating: {exc.message}", token),
            code="concurrent_generation",
            headers={"Retry-After": "10"},
        )
    if isinstance(exc, DataSerializationError):
        return OpenAIError(502, scrub(f"Unexpected NovelAI response: {exc.message}", token), code="upstream_error")
    if isinstance(exc, APIError):
        status = _sdk_status(exc)
        message = scrub(f"NovelAI error: {exc.message}", token)
        if status in (400, 402, 429):
            return OpenAIError(status, message, code="novelai_error")
        return OpenAIError(502, message, code="upstream_error")
    if isinstance(exc, SessionHttpError):
        return OpenAIError(502, scrub(f"Could not reach NovelAI: {exc}", token), code="upstream_unavailable")
    if isinstance(exc, TimeoutError):
        return OpenAIError(504, "NovelAI did not answer in time", code="timeout")
    return OpenAIError(500, "internal error", code="internal_error")


def _code(exc: APIError) -> int | None:
    try:
        return int(exc.code) if exc.code is not None else None
    except (TypeError, ValueError):
        return None


def _sdk_status(exc: APIError) -> int:
    code = _code(exc)
    if code in (400, 402, 429):
        return code
    return 502
