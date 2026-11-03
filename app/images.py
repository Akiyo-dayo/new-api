"""Image decoding, resizing and mask conversion (Pillow only, no SDK calls)."""

from __future__ import annotations

import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError

from .errors import bad_request, payload_too_large

# Pillow refuses images above this many pixels while decoding (decompression bombs).
Image.MAX_IMAGE_PIXELS = 4096 * 4096

MAX_DECODED_SIDE = 4096
DEFAULT_SIZE = (832, 1216)
MAX_PIXELS = 1_048_576
ACCEPTED_FORMATS = ("PNG", "JPEG", "WEBP")
_FORMAT_ALIASES = {"MPO": "JPEG"}


def decode_base64_image(value: str) -> bytes:
    """Decode a bare base64 string or a ``data:image/...;base64,`` URL."""
    text = value.strip()
    if text.startswith("data:"):
        _head, _sep, payload = text.partition(",")
        text = payload
    try:
        return base64.b64decode(text, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise bad_request("image is not valid base64") from exc


def load_image(raw: bytes, *, max_bytes: int, what: str = "image") -> Image.Image:
    """Decode the bytes into a Pillow image, enforcing the byte and pixel limits."""
    if not raw:
        raise bad_request(f"{what} is empty")
    if len(raw) > max_bytes:
        raise payload_too_large(f"{what} is larger than MAX_IMAGE_BYTES={max_bytes}")
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = _FORMAT_ALIASES.get((probe.format or "").upper(), (probe.format or "").upper())
            width, height = probe.size
            if fmt not in ACCEPTED_FORMATS:
                raise bad_request(f"{what} must be PNG, JPEG or WebP, got {probe.format or 'unknown'}")
            if width > MAX_DECODED_SIDE or height > MAX_DECODED_SIDE:
                raise bad_request(f"{what} is {width}x{height}, larger than 4096x4096")
            probe.load()
            return probe.copy()
    except UnidentifiedImageError as exc:
        raise bad_request(f"{what} is not a readable image") from exc
    except Image.DecompressionBombError as exc:
        raise bad_request(f"{what} is too large to decode") from exc
    except OSError as exc:
        # Truncated or corrupt file: the client's data, not a server fault.
        raise bad_request(f"{what} could not be decoded: {exc}") from exc


def flatten_to_rgb(image: Image.Image) -> Image.Image:
    """RGB image with any transparency laid over white."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        canvas.alpha_composite(rgba)
        return canvas.convert("RGB")
    return image.convert("RGB")


def to_png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def derive_size(image: Image.Image) -> tuple[int, int]:
    """Size used when the caller gave none: keep the ratio, fit 1 MP, snap to /64."""
    width, height = image.size
    # Snapping to /64 can round both sides up and creep over the pixel budget, so scale,
    # snap, and scale again until the snapped size really fits.
    for _ in range(8):
        pixels = width * height
        if pixels > MAX_PIXELS:
            factor = (MAX_PIXELS / pixels) ** 0.5
            width, height = width * factor, height * factor
        out_w, out_h = _snap(width), _snap(height)
        if out_w * out_h <= MAX_PIXELS:
            return out_w, out_h
        width, height = out_w * 0.98, out_h * 0.98
    return _snap(width), _snap(height)


def _snap(value: float) -> int:
    snapped = int(round(value / 64.0)) * 64
    return max(64, min(2048, snapped))


def parse_size(value: str) -> tuple[int, int]:
    if not isinstance(value, str):
        raise bad_request("size must be a string like 832x1216")
    text = value.strip().lower().replace("×", "x")
    parts = text.split("x")
    if len(parts) != 2:
        raise bad_request("size must look like WIDTHxHEIGHT, e.g. 832x1216")
    try:
        width, height = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise bad_request("size must look like WIDTHxHEIGHT, e.g. 832x1216") from exc
    if width % 64 or height % 64:
        raise bad_request("size width and height must be multiples of 64")
    if not (64 <= width <= 2048 and 64 <= height <= 2048):
        raise bad_request("size width and height must be within 64..2048")
    return width, height


def mask_to_novelai(raw: bytes, size: tuple[int, int], *, max_bytes: int) -> bytes:
    """Convert a client mask into NovelAI's RGB mask (white = repaint, black = keep).

    The OpenAI convention (alpha, transparent = repaint) is used when the mask really has
    partial transparency, otherwise the NovelAI convention (grey >= 128 = repaint).
    """
    image = load_image(raw, max_bytes=max_bytes, what="mask")
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    if has_alpha:
        alpha = image.convert("RGBA").getchannel("A")
        use_alpha = alpha.getextrema()[0] < 255
    else:
        alpha = None
        use_alpha = False

    resized_alpha = None
    if use_alpha and alpha is not None:
        resized_alpha = alpha.resize(size, Image.Resampling.NEAREST)
        binary = resized_alpha.point(lambda a: 255 if a < 128 else 0)
    else:
        grey = image.convert("L").resize(size, Image.Resampling.NEAREST)
        binary = grey.point(lambda v: 255 if v >= 128 else 0)

    if binary.getextrema()[1] == 0:
        raise bad_request("mask has no area to repaint")
    return to_png_bytes(binary.convert("RGB"))


def as_png_rgb(image: Image.Image, size: tuple[int, int]) -> bytes:
    """Initial image: flatten onto white, resize to exactly ``size`` with LANCZOS, PNG."""
    rgb = flatten_to_rgb(image)
    if rgb.size != size:
        rgb = rgb.resize(size, Image.Resampling.LANCZOS)
    return to_png_bytes(rgb)
