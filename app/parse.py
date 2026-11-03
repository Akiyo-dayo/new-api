"""Parse the incoming OpenAI-shaped request into an :class:`ImageJob`.

Only validation and normalisation happen here: no network access and no SDK calls, so a
bad request is rejected before any Anlas can be spent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from PIL import Image
from novelai_python.sdk.ai._enum import (
    NoiseSchedule,
    Sampler,
    get_max_characters,
    get_supported_noise_schedule,
    get_supported_params,
    supports_character_reference,
)
from novelai_python.sdk.ai.generate_image.params import get_default_params
from novelai_python.sdk.ai.generate_image.schema import CharacterPosition, PositionMap

from .config import Settings
from .errors import bad_request
from .images import (
    DEFAULT_SIZE,
    decode_base64_image,
    derive_size,
    flatten_to_rgb,
    load_image,
    mask_to_novelai,
    parse_size,
    to_png_bytes,
)

GENERATE = "generate"
IMG2IMG = "img2img"
INFILL = "infill"

MODEL_WHITELIST: frozenset[str] = frozenset(
    {
        "nai-diffusion-4-5-full",
        "nai-diffusion-4-5-curated",
        "nai-diffusion-4-5-full-inpainting",
        "nai-diffusion-4-5-curated-inpainting",
        "nai-diffusion-5-full",
        "nai-diffusion-5-full-medium",
        "nai-diffusion-5-curated",
        "nai-diffusion-5-full-inpainting",
        "nai-diffusion-5-full-medium-inpainting",
        "nai-diffusion-5-curated-inpainting",
    }
)

# Accepted spellings of the NovelAI parameters, mapped to one canonical name.
PARAM_ALIASES: dict[str, str] = {
    "uc": "negative_prompt",
    "uc_preset": "ucPreset",
    "quality_toggle": "qualityToggle",
}

PARAM_KEYS: tuple[str, ...] = (
    "steps",
    "scale",
    "cfg_rescale",
    "sampler",
    "noise_schedule",
    "seed",
    "negative_prompt",
    "ucPreset",
    "qualityToggle",
    "variety_boost",
    "decrisp_mode",
    "transparent_background",
    "characters",
    "strength",
    "noise",
    "extra_noise_seed",
    "add_original_image",
    "vibe_transfer",
    "character_reference",
)

CANONICAL_KEYS: frozenset[str] = frozenset(PARAM_KEYS)
ALLOWED_KEYS_TEXT = ", ".join(sorted(PARAM_KEYS))

CHAR_REF_DESCRIPTIONS = ("character", "style", "costume", "character&style", "delta")


@dataclass
class VibeSpec:
    image: bytes  # normalised PNG
    strength: float = 0.6
    information_extracted: float = 1.0


@dataclass
class CharacterRefSpec:
    image: bytes
    description: str = "character&style"
    strength: float = 1.0
    fidelity: float = 1.0
    information_extracted: float = 1.0


@dataclass
class ImageJob:
    model: str
    prompt: str
    n: int
    action: str
    size: tuple[int, int]
    image: Image.Image | None = None
    mask: bytes | None = None
    steps: int | None = None
    scale: float | None = None
    cfg_rescale: float | None = None
    sampler: str | None = None
    noise_schedule: str | None = None
    seed: int | None = None
    negative_prompt: str | None = None
    uc_preset: int | None = None
    quality_toggle: bool | None = None
    variety_boost: bool | None = None
    decrisp_mode: bool | None = None
    transparent_background: bool | None = None
    characters: list[dict[str, Any]] = field(default_factory=list)
    strength: float | None = None
    noise: float | None = None
    extra_noise_seed: int | None = None
    add_original_image: bool | None = None
    vibes: list[VibeSpec] = field(default_factory=list)
    character_references: list[CharacterRefSpec] = field(default_factory=list)

    @property
    def has_image(self) -> bool:
        return self.image is not None


# --------------------------------------------------------------------------- entry points


def parse_json_body(payload: Any, settings: Settings) -> ImageJob:
    if not isinstance(payload, dict):
        raise bad_request("Request body must be a JSON object")
    return _parse(_json_values(payload), settings)


def parse_multipart(items: list[tuple[str, str | bytes]], settings: Settings) -> ImageJob:
    """``items`` holds ``(field name, text or file bytes)`` pairs as sent by the client."""
    text: dict[str, Any] = {}
    image_files: list[bytes] = []
    mask_files: list[bytes] = []
    for key, value in items:
        if isinstance(value, bytes):
            if key in ("image", "image[]"):
                image_files.append(value)
            elif key == "mask":
                mask_files.append(value)
            continue
        if key in (
            "prompt",
            "model",
            "n",
            "size",
            "response_format",
            "stream",
            "parameters",
            "extra_fields",
            "image",
            "images",
            "mask",
        ):
            if key in text:
                raise bad_request(f"Duplicate multipart field: {key}")
            text[key] = value

    if len(image_files) > 1:
        raise bad_request("Only one image is supported per request")
    if len(mask_files) > 1:
        raise bad_request("Only one mask is supported per request")

    for name in ("parameters", "extra_fields"):
        if name in text:
            try:
                parsed = json.loads(text[name])
            except (TypeError, ValueError) as exc:
                raise bad_request(f"{name} must be a JSON object") from exc
            if not isinstance(parsed, dict):
                raise bad_request(f"{name} must be a JSON object")
            text[name] = parsed

    # Form fields arrive as strings; the shared validators expect the JSON types.
    if "n" in text:
        try:
            text["n"] = int(text["n"])
        except (TypeError, ValueError) as exc:
            raise bad_request("n must be an integer") from exc
    if "stream" in text:
        lowered = str(text["stream"]).strip().lower()
        if lowered not in ("true", "false"):
            raise bad_request("stream must be a boolean")
        text["stream"] = lowered == "true"

    values = _json_values(text)
    if image_files:
        values["image"] = image_files[0]
    if mask_files:
        values["mask"] = mask_files[0]
    return _parse(values, settings)


def _json_values(payload: dict[str, Any]) -> dict[str, Any]:
    """Collect the top-level fields we understand; every other field is ignored."""
    values: dict[str, Any] = {}
    for key in ("prompt", "model", "n", "size", "response_format", "stream"):
        if key in payload:
            values[key] = payload[key]

    if "image" in payload and payload["image"] is not None and "images" in payload and payload["images"] is not None:
        raise bad_request("Pass only one of image / images")
    if payload.get("image") is not None:
        values["image"] = payload["image"]
    elif payload.get("images") is not None:
        values["image"] = payload["images"]
    if payload.get("mask") is not None:
        values["mask"] = payload["mask"]

    parameters = payload.get("parameters")
    extra_fields = payload.get("extra_fields")
    if parameters is not None and not isinstance(parameters, dict):
        raise bad_request("parameters must be an object")
    if extra_fields is not None and not isinstance(extra_fields, dict):
        raise bad_request("extra_fields must be an object")
    merged = _canonical_params(extra_fields or {})
    merged.update(_canonical_params(parameters or {}))
    values["parameters"] = merged
    return values


def _canonical_params(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in raw.items():
        canonical = PARAM_ALIASES.get(key, key)
        if canonical not in CANONICAL_KEYS:
            raise bad_request(f"Unsupported parameter {key!r}; allowed keys are: {ALLOWED_KEYS_TEXT}")
        out[canonical] = value
    return out


# --------------------------------------------------------------------------- validation


def _parse(values: dict[str, Any], settings: Settings) -> ImageJob:
    model = _parse_model(values.get("model"))
    prompt = _parse_prompt(values.get("prompt"))
    n = _parse_n(values.get("n"), settings)
    _parse_response_format(values.get("response_format"))
    _parse_stream(values.get("stream"))

    image = None
    if "image" in values:
        _raw_image, decoded = _open_image(values["image"], "image", settings)
        image = flatten_to_rgb(decoded)
    raw_mask = _mask_bytes(values["mask"], settings) if "mask" in values else None
    if raw_mask is not None and image is None:
        raise bad_request("mask requires image")

    action = GENERATE
    if raw_mask is not None:
        action = INFILL
    elif image is not None:
        action = IMG2IMG

    size_value = values.get("size")
    if size_value is not None:
        size = parse_size(size_value)
    elif image is not None:
        size = derive_size(image)
    else:
        size = DEFAULT_SIZE
    if size[0] * size[1] > settings.max_pixels:
        raise bad_request(
            f"尺寸 {size[0]}x{size[1]} 超过本站上限（宽×高不超过 {settings.max_pixels} 像素，如 832x1216、1024x1024）"
            f" / size {size[0]}x{size[1]} exceeds {settings.max_pixels} pixels"
        )

    job = ImageJob(model=model, prompt=prompt, n=n, action=action, size=size, image=image)
    if raw_mask is not None:
        job.mask = mask_to_novelai(raw_mask, size, max_bytes=settings.max_image_bytes)

    _apply_params(job, values.get("parameters") or {}, settings)
    _check_action(job)
    return job


def _parse_model(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise bad_request("model is required")
    name = value.split("@", 1)[0].strip()
    if name not in MODEL_WHITELIST:
        allowed = ", ".join(sorted(MODEL_WHITELIST))
        raise bad_request(f"Unsupported model {name!r}; supported models are: {allowed}")
    return name


def _parse_prompt(value: Any) -> str:
    if not isinstance(value, str):
        raise bad_request("prompt is required")
    prompt = value.strip()
    if not prompt:
        raise bad_request("prompt must not be empty")
    return prompt


def _parse_n(value: Any, settings: Settings) -> int:
    # The SDK field itself allows 1..8; a misconfigured MAX_N must not reject everything.
    limit = max(1, min(settings.max_n, 8))
    if value is None:
        return 1
    n = _as_int(value, "n")
    if not 1 <= n <= limit:
        raise bad_request(f"每次最多生成 {limit} 张 / n must be between 1 and {limit}")
    return n


def _parse_response_format(value: Any) -> None:
    if value is None or value == "b64_json":
        return
    raise bad_request("response_format only supports 'b64_json'; url is not available")


def _parse_stream(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, bool):
        raise bad_request("stream must be a boolean")
    if value:
        raise bad_request("stream is not supported")


def _single_item(value: Any, what: str) -> str:
    if isinstance(value, list):
        if len(value) != 1:
            raise bad_request(f"{what} must contain exactly one image")
        value = value[0]
    if not isinstance(value, str) or not value.strip():
        raise bad_request(f"{what} must be a base64 string, a data: URL or a one-element array")
    return value


def _reject_url(text: str, what: str) -> None:
    if text.startswith(("http://", "https://")):
        raise bad_request(f"{what} URL is not supported; send base64 or a multipart file")


def _image_bytes(value: Any, what: str, settings: Settings) -> bytes:
    """Decode and validate an image field, returning the original bytes.

    Validation happens here so every image field (image, mask, vibe, character
    reference) fails the same way, before anything is priced or sent.
    """
    return _open_image(value, what, settings)[0]


def _open_image(value: Any, what: str, settings: Settings) -> tuple[bytes, Image.Image]:
    """Same as :func:`_image_bytes`, also returning the decoded image for callers that need it."""
    if isinstance(value, bytes):  # multipart upload, already the file content
        raw = value
    else:
        text = _single_item(value, what)
        _reject_url(text, what)
        raw = decode_base64_image(text)
    return raw, load_image(raw, max_bytes=settings.max_image_bytes, what=what)


def _mask_bytes(value: Any, settings: Settings) -> bytes:
    return _image_bytes(value, "mask", settings)


def _check_action(job: ImageJob) -> None:
    """Model / action compatibility, once the parameters are known."""
    if job.action != INFILL and job.model.endswith("-inpainting"):
        raise bad_request("An -inpainting model needs a mask; use a base model for img2img")


def _apply_params(job: ImageJob, params: dict[str, Any], settings: Settings) -> None:
    # The sampler first: noise_schedule is validated against it and JSON key order must not
    # decide whether a valid combination is accepted.
    if "sampler" in params:
        job.sampler = _parse_sampler(params["sampler"])

    for key, value in params.items():
        if key == "steps":
            job.steps = _as_int(value, "steps")
            limit = max(1, min(50, settings.max_steps))
            if not 1 <= job.steps <= limit:
                raise bad_request(f"步数需在 1 到 {limit} 之间 / steps must be between 1 and {limit}")
        elif key == "scale":
            # The SDK field is a multiple of 0.1, so 6.55 has to become 6.6 here.
            job.scale = round(_as_float(value, "scale"), 1)
            _range(job.scale, 0, 10, "scale")
        elif key == "cfg_rescale":
            job.cfg_rescale = round(_as_float(value, "cfg_rescale"), 2)
            _range(job.cfg_rescale, 0, 1, "cfg_rescale")
        elif key == "noise_schedule":
            job.noise_schedule = _parse_noise_schedule(value, job.sampler, job.model)
        elif key == "seed":
            seed = _as_int(value, "seed")
            # The SDK requires gt=0; 0 is the conventional "pick one for me".
            _range(seed, 0, 4294967288, "seed")
            job.seed = seed or None
        elif key == "negative_prompt":
            if not isinstance(value, str):
                raise bad_request("negative_prompt must be a string")
            job.negative_prompt = value
        elif key == "ucPreset":
            job.uc_preset = _as_int(value, "ucPreset")
            _range(job.uc_preset, 0, 3, "ucPreset")
        elif key == "qualityToggle":
            job.quality_toggle = _as_bool(value, "qualityToggle")
        elif key == "variety_boost":
            job.variety_boost = _as_bool(value, "variety_boost")
        elif key == "decrisp_mode":
            job.decrisp_mode = _as_bool(value, "decrisp_mode")
        elif key == "transparent_background":
            job.transparent_background = _as_bool(value, "transparent_background")
        elif key == "characters":
            job.characters = _parse_characters(value, job.model)
        elif key == "strength":
            job.strength = _round2(_as_float(value, "strength"), "strength")
            _range(job.strength, 0.01, 0.99, "strength")
        elif key == "noise":
            job.noise = _round2(_as_float(value, "noise"), "noise")
            _range(job.noise, 0, 0.99, "noise")
        elif key == "extra_noise_seed":
            extra = _as_int(value, "extra_noise_seed")
            _range(extra, 0, 4294967288, "extra_noise_seed")
            job.extra_noise_seed = extra or None
        elif key == "add_original_image":
            job.add_original_image = _as_bool(value, "add_original_image")
        elif key == "vibe_transfer":
            job.vibes = _parse_vibes(value, job.model, settings)
        elif key == "character_reference":
            job.character_references = _parse_character_references(value, job.model, settings)

    if job.transparent_background:
        if not _is_v5(job.model):
            raise bad_request("transparent_background is only available on V5 models")
        if job.action != GENERATE:
            raise bad_request("transparent_background is only available for text-to-image")
    if job.character_references and job.action != GENERATE:
        raise bad_request("character_reference is only available for text-to-image")
    if job.strength is not None and job.action == GENERATE:
        raise bad_request("strength is only available for img2img and infill")
    if job.noise is not None and job.action != IMG2IMG:
        raise bad_request("noise is only available for img2img")
    if job.extra_noise_seed is not None and job.action != IMG2IMG:
        raise bad_request("extra_noise_seed is only available for img2img")
    if job.add_original_image is not None and job.action != INFILL:
        raise bad_request("add_original_image is only available for infill")


def _parse_sampler(value: Any) -> str:
    if not isinstance(value, str):
        raise bad_request("sampler must be a string")
    try:
        return Sampler(value).value
    except ValueError as exc:
        allowed = ", ".join(s.value for s in Sampler)
        raise bad_request(f"Unsupported sampler {value!r}; allowed values are: {allowed}") from exc


def _parse_noise_schedule(value: Any, sampler: str | None, model: str) -> str:
    if not isinstance(value, str):
        raise bad_request("noise_schedule must be a string")
    try:
        schedule = NoiseSchedule(value)
    except ValueError as exc:
        allowed = ", ".join(s.value for s in NoiseSchedule)
        raise bad_request(f"Unsupported noise_schedule {value!r}; allowed values are: {allowed}") from exc
    sampler_value = sampler or get_default_params(model).sampler.value
    supported = get_supported_noise_schedule(Sampler(sampler_value), model)
    if schedule not in supported:
        names = ", ".join(s.value for s in supported) or "none"
        raise bad_request(
            f"noise_schedule {value!r} is not supported by sampler {sampler_value} on {model}; use: {names}"
        )
    return schedule.value


def _parse_characters(value: Any, model: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise bad_request("characters must be an array")
    limit = get_max_characters(model)
    if limit <= 0:
        raise bad_request(f"{model} does not support character prompts")
    if len(value) > limit:
        raise bad_request(f"characters supports at most {limit} entries for {model}")
    parsed: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise bad_request(f"characters[{index}] must be an object")
        unknown = set(item) - {"prompt", "uc", "center"}
        if unknown:
            raise bad_request(f"characters[{index}] has unsupported keys: {', '.join(sorted(unknown))}")
        if not isinstance(item.get("prompt"), str):
            raise bad_request(f"characters[{index}].prompt is required")
        uc = item.get("uc", "")
        if not isinstance(uc, str):
            raise bad_request(f"characters[{index}].uc must be a string")
        parsed.append(
            {"prompt": item["prompt"], "uc": uc, "center": _parse_center(item.get("center"), index)}
        )
    return parsed


def _parse_center(value: Any, index: int) -> PositionMap | CharacterPosition | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return PositionMap[value.strip().upper()]
        except KeyError as exc:
            raise bad_request(f"characters[{index}].center {value!r} is not a known position name") from exc
    if isinstance(value, dict):
        unknown = set(value) - {"x", "y"}
        if unknown:
            raise bad_request(f"characters[{index}].center has unsupported keys: {', '.join(sorted(unknown))}")
        x = _as_float(value.get("x"), f"characters[{index}].center.x")
        y = _as_float(value.get("y"), f"characters[{index}].center.y")
        # (0, 0) is the SDK's "let NovelAI place it" value, the rest of the grid ends at 0.9.
        _range(x, 0, 0.9, f"characters[{index}].center.x")
        _range(y, 0, 0.9, f"characters[{index}].center.y")
        if (x, y) == (0.0, 0.0):
            return PositionMap.AUTO
        return CharacterPosition(x=x, y=y)
    raise bad_request(f"characters[{index}].center must be {{x, y}} or a position name")


def _parse_vibes(value: Any, model: str, settings: Settings) -> list[VibeSpec]:
    if not get_supported_params(model).encodedVibes:
        raise bad_request(f"vibe_transfer is not supported by {model} (V4.5 only)")
    if not isinstance(value, list):
        raise bad_request("vibe_transfer must be an array")
    if len(value) > settings.max_vibes:
        raise bad_request(f"vibe_transfer supports at most {settings.max_vibes} entries")
    vibes: list[VibeSpec] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise bad_request(f"vibe_transfer[{index}] must be an object")
        unknown = set(item) - {"image", "strength", "information_extracted"}
        if unknown:
            raise bad_request(f"vibe_transfer[{index}] has unsupported keys: {', '.join(sorted(unknown))}")
        if "image" not in item:
            raise bad_request(f"vibe_transfer[{index}].image is required")
        _raw, image = _open_image(item["image"], f"vibe_transfer[{index}].image", settings)
        strength = _round2(_as_float(item.get("strength", 0.6), f"vibe_transfer[{index}].strength"), "strength")
        _range(strength, 0, 1, f"vibe_transfer[{index}].strength")
        info = _round2(
            _as_float(item.get("information_extracted", 1.0), f"vibe_transfer[{index}].information_extracted"),
            "information_extracted",
        )
        _range(info, 0, 1, f"vibe_transfer[{index}].information_extracted")
        vibes.append(VibeSpec(image=to_png_bytes(image), strength=strength, information_extracted=info))
    return vibes


def _parse_character_references(value: Any, model: str, settings: Settings) -> list[CharacterRefSpec]:
    if not supports_character_reference(model):
        raise bad_request(f"character_reference is not supported by {model} (V4.5 only)")
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list) or not value:
        raise bad_request("character_reference must be an object or a non-empty array")
    if len(value) > settings.max_char_refs:
        raise bad_request(f"character_reference supports at most {settings.max_char_refs} entries")
    refs: list[CharacterRefSpec] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise bad_request(f"character_reference[{index}] must be an object")
        unknown = set(item) - {"image", "description", "strength", "fidelity", "information_extracted"}
        if unknown:
            raise bad_request(f"character_reference[{index}] has unsupported keys: {', '.join(sorted(unknown))}")
        if "image" not in item:
            raise bad_request(f"character_reference[{index}].image is required")
        raw = _image_bytes(item["image"], f"character_reference[{index}].image", settings)
        description = item.get("description", "character&style")
        if description not in CHAR_REF_DESCRIPTIONS:
            raise bad_request(
                f"character_reference[{index}].description must be one of {', '.join(CHAR_REF_DESCRIPTIONS)}"
            )
        strength = _round2(_as_float(item.get("strength", 1.0), f"character_reference[{index}].strength"), "strength")
        _range(strength, 0, 1, f"character_reference[{index}].strength")
        fidelity = _round2(_as_float(item.get("fidelity", 1.0), f"character_reference[{index}].fidelity"), "fidelity")
        _range(fidelity, 0, 1, f"character_reference[{index}].fidelity")
        info = _round2(
            _as_float(item.get("information_extracted", 1.0), f"character_reference[{index}].information_extracted"),
            "information_extracted",
        )
        _range(info, 0, 1, f"character_reference[{index}].information_extracted")
        refs.append(
            CharacterRefSpec(
                image=raw,
                description=description,
                strength=strength,
                fidelity=fidelity,
                information_extracted=info,
            )
        )
    return refs


def _is_v5(model: str) -> bool:
    return model.startswith("nai-diffusion-5-")


# --------------------------------------------------------------------------- primitives


def _as_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise bad_request(f"{name} must be an integer")
    return value


def _as_float(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request(f"{name} must be a number")
    return float(value)


def _as_bool(value: Any, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise bad_request(f"{name} must be a boolean")


def _range(value: float, low: float, high: float, name: str) -> None:
    if not low <= value <= high:
        raise bad_request(f"{name} must be between {low:g} and {high:g}")


def _round2(value: float, name: str) -> float:
    """The SDK only accepts two-decimal strengths; reject precision we would silently change."""
    rounded = round(value, 2)
    if abs(rounded - value) > 1e-9:
        raise bad_request(f"{name} must be a multiple of 0.01")
    return rounded
