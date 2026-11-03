"""Offline tests: every NovelAI call is faked in ``conftest.Recorder``."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os

import pytest
from PIL import Image

from app import main
from app.build import VibeCache, vibe_cache_key
from app.config import settings
from app.images import load_image
from tests.conftest import TOKEN, b64, data_url, png

GEN = "/v1/images/generations"
EDITS = "/v1/images/edits"


def body(**overrides):
    payload = {
        "model": "nai-diffusion-4-5-full",
        "prompt": "1girl, blue eyes",
        "size": "832x1216",
    }
    payload.update(overrides)
    return payload


async def post(client, auth, path=GEN, **overrides):
    return await client.post(path, json=body(**overrides), headers=auth)


def file_image(size=(64, 64), color=(9, 9, 9), mode="RGB"):
    return {"image": ("in.png", png(size, color, mode), "image/png")}


# --------------------------------------------------------------------- routing and auth


async def test_healthz_is_open(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


async def test_models_lists_the_supported_models(client):
    response = await client.get("/v1/models")
    assert response.status_code == 200
    ids = [m["id"] for m in response.json()["data"]]
    assert "nai-diffusion-5-full" in ids
    assert "nai-diffusion-4-5-full" in ids
    assert response.json()["object"] == "list"


async def test_unknown_path_is_openai_404(client, auth):
    response = await client.post("/v1/chat/completions", json={}, headers=auth)
    assert response.status_code == 404
    error = response.json()["error"]
    assert set(error) == {"message", "type", "code"}
    assert "/v1/images/generations" in error["message"]


async def test_docs_are_not_exposed(client, auth):
    for path in ("/docs", "/redoc", "/openapi.json"):
        response = await client.get(path, headers=auth)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_trailing_slash_is_not_redirected(client, auth):
    response = await client.post(GEN + "/", json=body(), headers=auth)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_wrong_method_is_an_openai_error(client, auth):
    response = await client.get(GEN, headers=auth)
    assert response.status_code == 405
    assert set(response.json()["error"]) == {"message", "type", "code"}


async def test_missing_token_is_401(client):
    response = await client.post(GEN, json=body())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "missing_api_key"


async def test_bad_bearer_scheme_is_401(client):
    response = await client.post(GEN, json=body(), headers={"Authorization": "Basic abc"})
    assert response.status_code == 401


# --------------------------------------------------------------------- happy paths


async def test_text_to_image_defaults(client, auth, recorder):
    response = await post(client, auth, prompt=" 1girl ")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] > 0
    assert len(payload["data"]) == 1
    assert base64.b64decode(payload["data"][0]["b64_json"]) == recorder.files[0][1]
    assert "X-NAI-Anlas-Estimate" in response.headers

    params = recorder.params
    assert params.width == 832 and params.height == 1216
    assert params.n_samples == 1
    assert recorder.gen.input.startswith("1girl")
    assert recorder.gen.use_new_shared_trial is False
    # The SDK upgraded the shape for V4.5 and applied the quality suffix.
    assert params.params_version == 4


async def test_model_suffix_and_n(client, auth, recorder):
    """n images are n single-image NovelAI calls: only one image per call is free on Opus."""
    response = await post(client, auth, model="nai-diffusion-5-full@v1", n=3)
    assert response.status_code == 200, response.text
    assert len(response.json()["data"]) == 3
    assert len(recorder.generate) == 3
    assert all(gen.parameters.n_samples == 1 for gen in recorder.generate)
    assert recorder.gen.model.value == "nai-diffusion-5-full"


async def test_seeds_count_up_across_images(client, auth, recorder):
    """Seeds stay inside the SDK's 1..4294967288 range when they wrap."""
    response = await post(client, auth, n=3, parameters={"seed": 4294967288})
    assert response.status_code == 200, response.text
    assert [gen.parameters.seed for gen in recorder.generate] == [4294967288, 1, 2]


async def test_random_seed_is_shared_and_counts_up(client, auth, recorder):
    assert (await post(client, auth, n=2)).status_code == 200
    first, second = (gen.parameters.seed for gen in recorder.generate)
    assert second == first % main.SEED_MAX + 1


async def test_later_image_failure_keeps_the_images_already_made(client, auth, recorder, monkeypatch):
    from novelai_python._exceptions import APIError

    calls = 0
    original = main._generate

    async def flaky(gen, credential):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise APIError("upstream hiccup", request={}, response={}, code=500)
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", flaky)
    response = await post(client, auth, n=3)
    assert response.status_code == 200, response.text
    assert len(response.json()["data"]) == 1  # new-api bills the one image returned
    assert calls == 2  # the batch stops at the failure


async def test_first_image_failure_is_an_error(client, auth, monkeypatch):
    from novelai_python._exceptions import APIError

    async def broken(gen, credential):
        raise APIError("down", request={}, response={}, code=500)

    monkeypatch.setattr(main, "_generate", broken)
    response = await post(client, auth, n=2)
    assert response.status_code == 502


async def test_steps_scale_and_sampler_are_forwarded(client, auth, recorder):
    response = await post(
        client,
        auth,
        parameters={"steps": 12, "scale": 6.5, "sampler": "k_euler", "seed": 42, "uc": "bad"},
    )
    assert response.status_code == 200, response.text
    params = recorder.params
    assert params.steps == 12
    assert params.scale == 6.5
    assert params.sampler.value == "k_euler"
    assert params.seed == 42
    assert "bad" in params.negative_prompt


async def test_parameters_win_over_extra_fields(client, auth, recorder):
    response = await post(client, auth, parameters={"steps": 30}, extra_fields={"steps": 9})
    assert response.status_code == 200, response.text
    assert recorder.params.steps == 30


async def test_unknown_top_level_fields_are_ignored(client, auth, recorder):
    response = await post(client, auth, quality="hd", style="vivid", user="abc")
    assert response.status_code == 200, response.text


async def test_multipart_edits(client, auth, recorder, tmp_path):
    response = await client.post(
        EDITS,
        headers=auth,
        data={"model": "nai-diffusion-4-5-full", "prompt": "1girl", "n": "2", "size": "512x512"},
        files={"image": ("in.png", png((128, 256)), "image/png")},
    )
    assert response.status_code == 200, response.text
    assert len(recorder.generate) == 2 and recorder.params.n_samples == 1
    assert recorder.params.width == 512 and recorder.params.height == 512
    assert recorder.gen.action.value == "img2img"


# --------------------------------------------------------------------- actions


async def test_image_without_mask_is_img2img(client, auth, recorder):
    response = await client.post(
        EDITS, headers=auth, data={"model": "nai-diffusion-4-5-full", "prompt": "1girl"},
        files=file_image((128, 256)),
    )
    assert response.status_code == 200, response.text
    assert recorder.gen.action.value == "img2img"
    # No size given: derived from the source, snapped to /64 under 1 MP.
    params = recorder.params
    assert params.width % 64 == 0 and params.height % 64 == 0
    assert params.width * params.height <= 1_048_576
    assert params.height > params.width


def image_bytes(image: Image.Image, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    return buf.getvalue()


def half_mask(size=(64, 64)) -> bytes:
    """Left half white (repaint), right half black (keep)."""
    mask = Image.new("L", size, 0)
    for x in range(size[0] // 2):
        for y in range(size[1]):
            mask.putpixel((x, y), 255)
    return image_bytes(mask)


async def test_image_accepts_a_data_url(client, auth, recorder):
    response = await post(client, auth, image=data_url(png()), size="64x64")
    assert response.status_code == 200, response.text
    assert recorder.gen.action.value == "img2img"


async def test_image_accepts_a_one_element_array(client, auth, recorder):
    response = await post(client, auth, images=[b64(png())], size="64x64")
    assert response.status_code == 200, response.text
    assert recorder.gen.action.value == "img2img"


async def test_mask_is_infill_and_mask_is_converted(client, auth, recorder):
    response = await client.post(
        EDITS,
        headers=auth,
        data={"model": "nai-diffusion-4-5-full", "prompt": "1girl", "size": "64x64"},
        files={
            "image": ("in.png", png((64, 64), (255, 255, 255)), "image/png"),
            "mask": ("m.png", half_mask(), "image/png"),
        },
    )
    assert response.status_code == 200, response.text
    assert recorder.gen.action.value == "infill"
    converted = load_image(base64.b64decode(recorder.params.mask), max_bytes=10_485_760, what="mask")
    assert converted.mode == "RGB"
    assert converted.convert("L").getextrema() == (0, 255)  # both keep and repaint present


async def test_mask_without_image_is_400(client, auth):
    response = await client.post(EDITS, headers=auth, data={"model": "nai-diffusion-4-5-full", "prompt": "x"},
                                 files={"mask": ("m.png", png(), "image/png")})
    assert response.status_code == 400
    assert "requires image" in response.json()["error"]["message"]


async def test_inpainting_model_without_mask_is_400(client, auth):
    response = await post(client, auth, model="nai-diffusion-4-5-full-inpainting")
    assert response.status_code == 400
    assert "inpainting" in response.json()["error"]["message"]


async def test_alpha_mask_uses_openai_convention(client, auth, recorder):
    """Alpha < 128 means repaint; the grey channel of such a mask is ignored."""
    rgba = Image.new("RGBA", (64, 64), (0, 0, 0, 0))  # fully transparent, grey value 0
    response = await client.post(
        EDITS,
        headers=auth,
        data={"model": "nai-diffusion-4-5-full", "prompt": "x", "size": "64x64"},
        files={
            "image": ("in.png", png(), "image/png"),
            "mask": ("m.png", image_bytes(rgba), "image/png"),
        },
    )
    assert response.status_code == 200, response.text
    converted = load_image(base64.b64decode(recorder.params.mask), max_bytes=10_485_760, what="mask")
    assert converted.convert("L").getextrema() == (255, 255)  # all repaint


async def test_empty_mask_is_400(client, auth):
    response = await client.post(
        EDITS,
        headers=auth,
        data={"model": "nai-diffusion-4-5-full", "prompt": "x", "size": "64x64"},
        files={
            "image": ("in.png", png(), "image/png"),
            "mask": ("m.png", image_bytes(Image.new("L", (64, 64), 0)), "image/png"),
        },
    )
    assert response.status_code == 400
    assert "repaint" in response.json()["error"]["message"]


# --------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "overrides,needle",
    [
        ({"model": "nai-diffusion-3"}, "Unsupported model"),
        ({"prompt": "   "}, "prompt"),
        ({"n": 0}, "n must be between"),
        ({"n": 99}, "n must be between"),
        ({"size": "832x1200"}, "multiples of 64"),
        ({"size": "4096x4096"}, "64..2048"),
        ({"response_format": "url"}, "b64_json"),
        ({"stream": True}, "stream"),
        ({"image": ["a", "b"]}, "exactly one"),
        ({"image": "https://example.com/a.png"}, "URL is not supported"),
        ({"parameters": {"cfg": 5}}, "allowed keys are"),
        ({"parameters": {"n_samples": 4}}, "allowed keys are"),
        ({"parameters": {"characters": [{"prompt": "a"}] * 7}}, "at most"),
        ({"parameters": {"characters": [{"prompt": "a", "center": {"x": 1.5, "y": 0}}]}}, "center.x"),
        ({"parameters": {"vibe_transfer": []}, "model": "nai-diffusion-5-full"}, "not supported"),
        ({"parameters": {"character_reference": {"image": b64(png())}}, "model": "nai-diffusion-5-full"},
         "not supported"),
        ({"parameters": {"strength": 0.5}}, "only available for img2img"),
        ({"parameters": {"add_original_image": True}}, "only available for infill"),
    ],
)
async def test_rejections(client, auth, overrides, needle):
    response = await post(client, auth, **overrides)
    assert response.status_code == 400, response.text
    assert needle in response.json()["error"]["message"]


async def test_character_reference_in_t2i_is_accepted(client, auth, recorder):
    response = await post(client, auth, parameters={"character_reference": {"image": b64(png())}})
    assert response.status_code == 200, response.text
    assert len(recorder.params.director_reference_images) == 1


async def test_body_too_large_is_413(client, auth):
    payload = body(prompt="x" * (41 * 1024 * 1024))
    response = await client.post(GEN, content=json.dumps(payload), headers={**auth, "Content-Type": "application/json"})
    assert response.status_code == 413


async def test_oversized_image_is_413(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "max_image_bytes", 100)
    response = await client.post(EDITS, headers=auth, data={"model": "nai-diffusion-4-5-full", "prompt": "x"},
                                 files={"image": ("in.png", png((256, 256)), "image/png")})
    assert response.status_code == 413


async def test_unsupported_image_format_is_400(client, auth):
    response = await client.post(
        EDITS, headers=auth, data={"model": "nai-diffusion-4-5-full", "prompt": "x"},
        files={"image": ("in.bmp", b"BM" + b"\x00" * 100, "image/bmp")},
    )
    assert response.status_code == 400


async def test_truncated_png_is_400_not_500(client, auth):
    raw = png((128, 128))
    truncated = raw[: len(raw) // 2]
    response = await client.post(
        EDITS, headers=auth, data={"model": "nai-diffusion-4-5-full", "prompt": "x"},
        files={"image": ("in.png", truncated, "image/png")},
    )
    assert response.status_code == 400, response.text
    assert "internal error" not in response.json()["error"]["message"]


async def test_image_and_images_together_is_400(client, auth):
    response = await post(client, auth, image=b64(png()), images=[b64(png())])
    assert response.status_code == 400
    assert "only one of image / images" in response.json()["error"]["message"]


# --------------------------------------------------------------------- characters


async def test_characters_with_position_names_and_points(client, auth, recorder):
    response = await post(
        client,
        auth,
        parameters={
            "characters": [
                {"prompt": "girl", "uc": "bad hands", "center": {"x": 0.3, "y": 0.5}},
                {"prompt": "boy", "center": "E5"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    chars = recorder.params.characterPrompts
    assert [c.prompt for c in chars] == ["girl", "boy"]
    assert chars[0].uc == "bad hands"
    assert (chars[0].center.x, chars[0].center.y) == (0.3, 0.5)
    assert (chars[1].center.value.x, chars[1].center.value.y) == (0.9, 0.9)
    assert recorder.params.use_coords is True


# --------------------------------------------------------------------- vibes


async def test_no_vibes_leaves_no_placeholder_reference(client, auth, recorder):
    """The pricing placeholder must never survive into a real request."""
    response = await post(client, auth)
    assert response.status_code == 200, response.text
    params = recorder.params
    assert not params.reference_image_multiple
    assert not params.reference_strength_multiple
    assert not params.reference_information_extracted_multiple


async def test_vibe_transfer_encodes_and_sets_references(client, auth, recorder):
    response = await post(
        client,
        auth,
        parameters={"vibe_transfer": [{"image": b64(png()), "strength": 0.4}]},
    )
    assert response.status_code == 200, response.text
    assert len(recorder.vibes) == 1
    assert recorder.params.reference_image_multiple == ["ENCODED-VIBE"]
    assert recorder.params.reference_strength_multiple == [0.4]
    assert recorder.params.reference_information_extracted_multiple == [1.0]


async def test_vibe_cache_avoids_a_second_encode(client, auth, recorder):
    payload = {"vibe_transfer": [{"image": b64(png()), "strength": 0.4}]}
    assert (await post(client, auth, parameters=payload)).status_code == 200
    assert (await post(client, auth, parameters=payload)).status_code == 200
    assert len(recorder.vibes) == 1
    assert len(recorder.generate) == 2


async def test_vibe_cache_key_is_normalised(client, auth, recorder):
    first = png((64, 64), (5, 5, 5))
    # The same picture saved again from a re-encoded file must hit the cache, not the encoder.
    with Image.open(io.BytesIO(first)) as handle:
        again = image_bytes(handle.convert("RGB"))
    assert (await post(client, auth, parameters={"vibe_transfer": [{"image": b64(first)}]})).status_code == 200
    assert (await post(client, auth, parameters={"vibe_transfer": [{"image": b64(again)}]})).status_code == 200
    assert len(recorder.vibes) == 1


# --------------------------------------------------------------------- Anlas


async def test_anlas_limit_blocks_before_any_call(client, auth, recorder, monkeypatch):
    # A free Opus generation costs 0, so the limit only bites on a paid request.
    monkeypatch.setattr(settings, "nai_opus", False)
    monkeypatch.setattr(settings, "max_anlas_per_image", 1)
    response = await post(client, auth)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "anlas_limit"
    assert recorder.generate == [] and recorder.vibes == []


async def test_free_opus_generation_estimates_zero(client, auth, recorder):
    """832x1216 at 28 steps is inside the Opus free tier, so the estimate is 0."""
    response = await post(client, auth)
    assert response.status_code == 200
    assert response.headers["X-NAI-Anlas-Estimate"] == "0"


async def test_anlas_limit_counts_uncached_vibes(client, auth, recorder, monkeypatch):
    monkeypatch.setattr(settings, "vibe_encode_anlas", 2)
    base = await post(client, auth)
    assert base.status_code == 200
    estimate = int(base.headers["X-NAI-Anlas-Estimate"])
    monkeypatch.setattr(settings, "max_anlas_per_image", estimate + 1)
    # One encode (+2) pushes it over.
    response = await post(client, auth, parameters={"vibe_transfer": [{"image": b64(png())}]})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "anlas_limit"


async def test_anlas_limit_ignores_cached_vibes(client, auth, recorder, monkeypatch):
    payload = {"vibe_transfer": [{"image": b64(png())}]}
    assert (await post(client, auth, parameters=payload)).status_code == 200  # fills the cache
    monkeypatch.setattr(settings, "max_anlas_per_image", 1)
    response = await post(client, auth, parameters=payload)
    assert response.status_code == 200, response.text
    assert response.headers["X-NAI-Anlas-Estimate"] == "0"


async def test_cost_failure_rejects(client, auth, monkeypatch):
    from novelai_python.sdk.ai.generate_image import GenerateImageInfer

    def boom(self, is_opus=False, usage_negative=False):
        raise ValueError("Failed to calculate cost")

    monkeypatch.setattr(GenerateImageInfer, "calculate_cost", boom)
    response = await post(client, auth)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "anlas_limit"


# --------------------------------------------------------------------- queue and SDK errors


async def test_queue_full_is_429(client, auth, recorder, monkeypatch):
    """With MAX_QUEUE=0 a token that is already busy rejects instead of queueing."""
    monkeypatch.setattr(main, "queues", main.TokenQueues(max_queue=0, timeout=5))
    release = asyncio.Event()
    original = main._generate

    async def blocked(gen, credential):
        await release.wait()
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", blocked)
    first = asyncio.create_task(post(client, auth))
    await asyncio.sleep(0.05)  # the first request now holds the lock
    second = await post(client, auth)
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "queue_full"
    release.set()
    assert (await first).status_code == 200


async def test_queue_timeout_is_429(client, auth, recorder, monkeypatch):
    monkeypatch.setattr(main, "queues", main.TokenQueues(max_queue=4, timeout=0.05))
    release = asyncio.Event()
    original = main._generate

    async def blocked(gen, credential):
        await release.wait()
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", blocked)
    first = asyncio.create_task(post(client, auth))
    await asyncio.sleep(0.05)
    second = await post(client, auth)
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "queue_timeout"
    release.set()
    assert (await first).status_code == 200


async def test_queue_rejects_when_the_expected_wait_is_too_long(client, auth, recorder, monkeypatch):
    """With ~10 s per generation and a 15 s budget one waiter fits, a second does not."""
    monkeypatch.setattr(
        main, "queues", main.TokenQueues(max_queue=8, timeout=5, max_wait=15, default_seconds=10)
    )
    release = asyncio.Event()
    original = main._generate

    async def blocked(gen, credential):
        await release.wait()
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", blocked)
    first = asyncio.create_task(post(client, auth))
    await asyncio.sleep(0.05)
    second = asyncio.create_task(post(client, auth))
    await asyncio.sleep(0.05)
    third = await post(client, auth)
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "queue_full"
    assert third.headers["retry-after"] == "10"
    release.set()
    assert (await first).status_code == 200
    assert (await second).status_code == 200


async def test_caller_that_leaves_the_queue_never_generates(client, auth, recorder, monkeypatch):
    """A queued request whose caller disconnected is dropped and the lock is not leaked."""
    from starlette.requests import Request

    async def gone(self):
        return self.headers.get("x-test-gone") == "1"

    monkeypatch.setattr(Request, "is_disconnected", gone)
    release = asyncio.Event()
    original = main._generate

    async def blocked(gen, credential):
        await release.wait()
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", blocked)
    first = asyncio.create_task(post(client, auth))
    await asyncio.sleep(0.05)
    leaving = await client.post(GEN, json=body(), headers={**auth, "x-test-gone": "1"})
    assert leaving.status_code == 499
    release.set()
    assert (await first).status_code == 200
    assert len(recorder.generate) == 1
    # The lock must be free again for the next caller.
    assert (await post(client, auth)).status_code == 200
    assert len(recorder.generate) == 2


async def test_size_over_max_pixels_is_400(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "max_pixels", 1_048_576)
    response = await post(client, auth, size="1024x1536")
    assert response.status_code == 400
    assert "1048576" in response.json()["error"]["message"]


async def test_zero_anlas_ceiling_admits_only_free_requests(client, auth, recorder, monkeypatch):
    monkeypatch.setattr(settings, "max_anlas_per_image", 0)
    free = await post(client, auth, n=2)  # split into two calls, each free on Opus
    assert free.status_code == 200, free.text
    assert free.headers["X-NAI-Anlas-Estimate"] == "0"
    paid = await post(client, auth, size="1024x1536")  # above 1 MP is never free
    assert paid.status_code == 400
    assert paid.json()["error"]["code"] == "anlas_limit"
    assert len(recorder.generate) == 2


async def test_anlas_ceiling_is_per_image(client, auth, recorder, monkeypatch):
    """1024x1536 at 28 steps costs 30 Anlas per V4.5 image."""
    monkeypatch.setattr(settings, "max_anlas_per_image", 30)
    two = await post(client, auth, size="1024x1536", n=2)
    assert two.status_code == 200, two.text
    assert two.headers["X-NAI-Anlas-Estimate"] == "60"
    monkeypatch.setattr(settings, "max_anlas_per_image", 29)
    assert (await post(client, auth, size="1024x1536", n=2)).status_code == 400


async def test_queue_estimate_counts_images_not_requests(client, auth, recorder, monkeypatch):
    """A running 3-image request is ~30 s of work at 10 s per image."""
    monkeypatch.setattr(
        main, "queues", main.TokenQueues(max_queue=8, timeout=5, max_wait=25, default_seconds=10)
    )
    release = asyncio.Event()
    original = main._generate

    async def blocked(gen, credential):
        await release.wait()
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", blocked)
    batch = asyncio.create_task(post(client, auth, n=3))
    await asyncio.sleep(0.05)
    turned_away = await post(client, auth)
    assert turned_away.status_code == 429
    assert turned_away.headers["retry-after"] == "30"
    release.set()
    assert (await batch).status_code == 200


async def test_infill_does_not_overlay_the_original_by_default(client, auth, recorder):
    def infill(extra=None):
        data = {"model": "nai-diffusion-4-5-full", "prompt": "1girl", "size": "64x64"}
        if extra:
            data["parameters"] = json.dumps(extra)
        return client.post(
            EDITS,
            headers=auth,
            data=data,
            files={
                "image": ("in.png", png((64, 64), (255, 255, 255)), "image/png"),
                "mask": ("m.png", half_mask(), "image/png"),
            },
        )

    assert (await infill()).status_code == 200
    assert recorder.params.add_original_image is False
    assert (await infill({"add_original_image": True})).status_code == 200
    assert recorder.params.add_original_image is True


async def test_concurrent_requests_on_one_token_are_serialised(client, auth, recorder, monkeypatch):
    """Two requests sharing a token must not overlap; the lock is per token hash."""
    order: list[str] = []
    original = main._generate

    async def slow(gen, credential):
        order.append("start")
        await asyncio.sleep(0.05)
        order.append("end")
        return await original(gen, credential)

    monkeypatch.setattr(main, "_generate", slow)
    first, second = await asyncio.gather(post(client, auth), post(client, auth))
    assert first.status_code == second.status_code == 200
    assert order == ["start", "end", "start", "end"]


async def test_auth_error_maps_to_401(client, auth, monkeypatch):
    from novelai_python._exceptions import AuthError

    async def reject(self, session, **kwargs):
        raise AuthError("bad token", request={}, response={}, code=401)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", reject)
    response = await post(client, auth)
    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "invalid_api_key"
    assert TOKEN not in error["message"]


async def test_auth_error_402_is_not_reported_as_a_bad_token(client, auth, monkeypatch):
    """The SDK raises AuthError for 400/402 too; only a real 401 means the token is wrong."""
    from novelai_python._exceptions import AuthError

    async def broke(self, session, **kwargs):
        raise AuthError("Not enough Anlas", request={}, response={}, code=402)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", broke)
    response = await post(client, auth)
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "insufficient_quota"


async def test_auth_error_400_is_a_bad_request(client, auth, monkeypatch):
    from novelai_python._exceptions import AuthError

    async def reject(self, session, **kwargs):
        raise AuthError("invalid parameters", request={}, response={}, code=400)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", reject)
    response = await post(client, auth)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "novelai_error"


async def test_concurrent_generation_maps_to_429(client, auth, monkeypatch):
    from novelai_python._exceptions import ConcurrentGenerationError

    async def busy(self, session, **kwargs):
        raise ConcurrentGenerationError("already generating", request={}, response={}, code=429)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", busy)
    response = await post(client, auth)
    assert response.status_code == 429


async def test_api_error_402_passes_through(client, auth, monkeypatch):
    from novelai_python._exceptions import APIError

    async def broke(self, session, **kwargs):
        raise APIError("Not enough Anlas", request={}, response={}, code=402)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", broke)
    response = await post(client, auth)
    assert response.status_code == 402
    assert "Not enough Anlas" in response.json()["error"]["message"]


async def test_api_error_500_becomes_502(client, auth, monkeypatch):
    from novelai_python._exceptions import APIError

    async def broken(self, session, **kwargs):
        raise APIError("upstream exploded", request={}, response={}, code=500)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", broken)
    response = await post(client, auth)
    assert response.status_code == 502
    assert "upstream exploded" in response.json()["error"]["message"]


async def test_timeout_is_504(client, auth, monkeypatch):
    async def slow(self, session, **kwargs):
        await asyncio.sleep(5)

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", slow)
    monkeypatch.setattr(settings, "nai_timeout_seconds", 0.05)
    response = await post(client, auth)
    assert response.status_code == 504


async def test_unexpected_failure_hides_details(client, auth, monkeypatch):
    async def explode(self, session, **kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", explode)
    response = await post(client, auth)
    assert response.status_code == 500
    assert "secret internal detail" not in response.json()["error"]["message"]


# --------------------------------------------------------------------- logging


async def test_log_line_hides_token_prompt_and_pixels(client, auth, recorder, caplog):
    import logging

    caplog.set_level(logging.INFO, logger="nai_adapter")
    response = await post(client, auth, prompt="very private prompt")
    assert response.status_code == 200
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert TOKEN not in text
    assert "very private prompt" not in text
    assert b64(recorder.files[0][1]) not in text
    assert '"status": 200' in text


# --------------------------------------------------------------------- cache unit


def test_vibe_cache_roundtrip_and_trim(tmp_path):
    cache = VibeCache(tmp_path, max_entries=2)
    cache.put("a", "1")
    cache.put("b", "2")
    # Make the age order explicit instead of trusting filesystem timestamp resolution.
    os.utime(tmp_path / "a", (1_000_000, 1_000_000))
    os.utime(tmp_path / "b", (1_000_001, 1_000_001))
    cache.put("c", "3")
    assert cache.get("c") == "3"
    # 'a' was the least recently used and is gone once the entry count is over the limit.
    assert cache.get("a") is None
    assert cache.get("b") == "2"
    assert len(list(tmp_path.iterdir())) == 2


def test_vibe_cache_survives_an_unwritable_directory(tmp_path):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("x", encoding="utf-8")
    cache = VibeCache(blocker, max_entries=2)
    cache.put("a", "1")  # must not raise
    assert cache.get("a") is None


def test_vibe_cache_zero_disables_writes(tmp_path):
    cache = VibeCache(tmp_path, max_entries=0)
    cache.put("a", "1")
    assert cache.get("a") is None
    assert list(tmp_path.iterdir()) == []


def test_vibe_cache_key_format():
    key = vibe_cache_key(b"abc", "nai-diffusion-4-5-full", 0.5)
    assert key.endswith("-nai-diffusion-4-5-full-0.50.txt")
