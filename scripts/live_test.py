#!/usr/bin/env python3
"""Live smoke test against a running nai-adapter.

It spends real Anlas (8 requests, 28 steps, 832x1216 by default), so it asks for
confirmation unless ``--yes`` is given. Every image is written to ``--out``.

    NAI_TOKEN=pst-... python scripts/live_test.py --base http://localhost:8000
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw

DEFAULT_SIZE = "832x1216"
STEPS = 28


def make_png(size: tuple[int, int], color: tuple[int, int, int], mode: str = "RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format="PNG")
    return buf.getvalue()


def white_rectangle_mask(size: tuple[int, int]) -> bytes:
    """Black canvas with a white rectangle in the middle: NovelAI repaints white."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(
        [size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4],
        fill=255,
    )
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return buf.getvalue()


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def post(base: str, token: str, route: str, payload: dict, files: dict[str, tuple[str, bytes]] | None = None):
    """POST JSON, or multipart when ``files`` is given. Returns (status, parsed body)."""
    url = f"{base.rstrip('/')}{route}"
    headers = {"Authorization": f"Bearer {token}"}
    if files:
        boundary = f"----naiadapter{int(time.time() * 1000)}"
        chunks: list[bytes] = []
        for name, value in payload.items():
            # The adapter expects the nested fields as JSON strings in a form body.
            text = json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
            chunks.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{text}\r\n".encode()
            )
        for name, (filename, data) in files.items():
            chunks.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n".encode()
                + data
                + b"\r\n"
            )
        chunks.append(f"--{boundary}--\r\n".encode())
        body = b"".join(chunks)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    else:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, {"raw": raw[:400].decode("utf-8", "replace")}


def save_images(out_dir: str, case: str, payload: dict) -> list[str]:
    saved = []
    for index, item in enumerate(payload.get("data") or []):
        raw = base64.b64decode(item["b64_json"])
        path = os.path.join(out_dir, f"{case}-{index}.png")
        with open(path, "wb") as handle:
            handle.write(raw)
        saved.append(path)
    return saved


def build_cases() -> list[dict]:
    base = {"n": 1, "size": DEFAULT_SIZE, "parameters": {"steps": STEPS}}
    source = make_png((832, 1216), (40, 90, 160))
    mask = white_rectangle_mask((832, 1216))
    vibe_source = make_png((832, 1216), (200, 120, 60))
    character = make_png((832, 1216), (90, 160, 90))

    return [
        {
            "name": "v45-t2i",
            "description": "V4.5 text-to-image",
            "route": "/v1/images/generations",
            "payload": {**base, "model": "nai-diffusion-4-5-full", "prompt": "1girl, blue eyes, city at night"},
        },
        {
            "name": "v5-t2i",
            "description": "V5 text-to-image",
            "route": "/v1/images/generations",
            "payload": {**base, "model": "nai-diffusion-5-full", "prompt": "1girl, blue eyes, city at night"},
        },
        {
            "name": "v45-i2i",
            "description": "V4.5 image-to-image",
            "route": "/v1/images/edits",
            "payload": {
                **base,
                "model": "nai-diffusion-4-5-full",
                "prompt": "1girl, watercolor",
                "parameters": {"steps": STEPS, "strength": 0.6},
            },
            "files": {"image": ("source.png", source)},
        },
        {
            "name": "v5-i2i",
            "description": "V5 image-to-image",
            "route": "/v1/images/edits",
            "payload": {
                **base,
                "model": "nai-diffusion-5-full",
                "prompt": "1girl, watercolor",
                "parameters": {"steps": STEPS, "strength": 0.6},
            },
            "files": {"image": ("source.png", source)},
        },
        {
            "name": "v45-infill",
            "description": "V4.5 inpainting with a white rectangle mask",
            "route": "/v1/images/edits",
            "payload": {
                **base,
                "model": "nai-diffusion-4-5-full-inpainting",
                "prompt": "1girl, inside the frame",
                "parameters": {"steps": STEPS},
            },
            "files": {"image": ("source.png", source), "mask": ("mask.png", mask)},
        },
        {
            "name": "v5-infill",
            "description": "V5 inpainting with a white rectangle mask",
            "route": "/v1/images/edits",
            "payload": {
                **base,
                "model": "nai-diffusion-5-full-inpainting",
                "prompt": "1girl, inside the frame",
                "parameters": {"steps": STEPS},
            },
            "files": {"image": ("source.png", source), "mask": ("mask.png", mask)},
        },
        {
            "name": "v45-vibe",
            "description": "V4.5 vibe transfer (one reference)",
            "route": "/v1/images/generations",
            "payload": {
                **base,
                "model": "nai-diffusion-4-5-full",
                "prompt": "1girl, blue eyes",
                "parameters": {
                    "steps": STEPS,
                    "vibe_transfer": [{"image": b64(vibe_source), "strength": 0.6, "information_extracted": 1.0}],
                },
            },
        },
        {
            "name": "v45-charref",
            "description": "V4.5 Precise Reference (character reference), text-to-image only",
            "route": "/v1/images/generations",
            "payload": {
                **base,
                "model": "nai-diffusion-4-5-full",
                "prompt": "1girl, blue eyes, standing",
                "parameters": {
                    "steps": STEPS,
                    "character_reference": [
                        {"image": b64(character), "description": "character", "strength": 1.0, "fidelity": 1.0}
                    ],
                },
            },
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:8000", help="adapter base URL")
    parser.add_argument("--out", default="./live-out", help="directory for the generated images")
    parser.add_argument("--yes", action="store_true", help="do not ask before spending Anlas")
    parser.add_argument("--only", help="run a single case by name")
    args = parser.parse_args()

    token = os.environ.get("NAI_TOKEN", "").strip()
    if not token:
        print("NAI_TOKEN is not set", file=sys.stderr)
        return 2

    cases = [c for c in build_cases() if not args.only or c["name"] == args.only]
    if not cases:
        print(f"no case named {args.only!r}", file=sys.stderr)
        return 2

    if not args.yes:
        answer = input(f"{len(cases)} requests will spend Anlas. Continue? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("aborted")
            return 1

    os.makedirs(args.out, exist_ok=True)
    failures = 0
    for case in cases:
        print(f"\n== {case['name']}: {case['description']}")
        started = time.time()
        status, payload = post(args.base, token, case["route"], case["payload"], case.get("files"))
        elapsed = time.time() - started
        if status != 200:
            failures += 1
            print(f"  FAILED {status} in {elapsed:.1f}s: {json.dumps(payload, ensure_ascii=False)[:500]}")
            continue
        paths = save_images(args.out, case["name"], payload)
        if not paths:
            failures += 1
            print("  FAILED: no data returned")
            continue
        print(f"  ok in {elapsed:.1f}s -> {', '.join(paths)}")

    print(f"\n{len(cases) - failures}/{len(cases)} cases passed, images in {os.path.abspath(args.out)}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
