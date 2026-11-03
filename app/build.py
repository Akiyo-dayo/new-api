"""Turn an :class:`ImageJob` into an SDK ``GenerateImageInfer`` and encode vibe images."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any

from novelai_python.sdk.ai._enum import NoiseSchedule
from novelai_python.sdk.ai.encode_vibe import EncodeVibe
from novelai_python.sdk.ai.generate_image import GenerateImageInfer
from novelai_python.sdk.ai.generate_image.schema import Character, CharacterReference, PositionMap

from .images import as_png_rgb
from .parse import GENERATE, INFILL, ImageJob, VibeSpec

# Held in reference_image_multiple while a request is only being priced: any non-empty
# list makes the SDK count the vibes, so the price covers them before an encode call.
_VIBE_PLACEHOLDER = "pending-vibe-encode"


def vibe_cache_key(png: bytes, model: str, information_extracted: float) -> str:
    digest = hashlib.sha256(png).hexdigest()
    return f"{digest}-{model}-{information_extracted:.2f}.txt"


class VibeCache:
    """One file per encoded vibe under ``directory``, oldest entries evicted past the limit."""

    def __init__(self, directory: str | Path, max_entries: int) -> None:
        self.directory = Path(directory)
        self.max_entries = max_entries

    def _path(self, key: str) -> Path:
        return self.directory / key

    def has(self, key: str) -> bool:
        return self._path(key).is_file()

    def get(self, key: str) -> str | None:
        path = self._path(key)
        try:
            value = path.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not value:
            return None
        try:
            os.utime(path, None)  # eviction follows real use, not first write
        except OSError:
            pass
        return value

    def put(self, key: str, value: str) -> None:
        if self.max_entries <= 0:
            return  # VIBE_CACHE_MAX=0 turns the cache off instead of letting it grow forever
        tmp: str | None = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.directory, prefix=".tmp-", suffix=".vibe")
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(value)
            os.replace(tmp, self._path(key))
            tmp = None
            self._prune()
        except OSError:
            # The cache is an optimisation: a broken volume must not fail generation.
            return
        finally:
            if tmp is not None:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    def _prune(self) -> None:
        try:
            entries = [p for p in self.directory.iterdir() if p.is_file() and not p.name.startswith(".tmp-")]
        except OSError:
            return
        if len(entries) <= self.max_entries:
            return
        entries.sort(key=lambda p: p.stat().st_mtime)
        for path in entries[: len(entries) - self.max_entries]:
            try:
                path.unlink()
            except OSError:
                pass


async def encode_vibes(
    vibes: list[VibeSpec],
    model: str,
    credential: Any,
    cache: VibeCache,
) -> list[str]:
    """One encoded vibe per spec, reusing the disk cache and de-duplicating within the request."""
    encoded: list[str] = []
    seen: dict[str, str] = {}
    for vibe in vibes:
        key = vibe_cache_key(vibe.image, model, vibe.information_extracted)
        value = seen.get(key) or cache.get(key)
        if value is None:
            response = await EncodeVibe(
                image=vibe.image,
                model=model,
                information_extracted=vibe.information_extracted,
            ).request(session=credential)
            value = response.vibe_b64
            cache.put(key, value)
        seen[key] = value
        encoded.append(value)
    return encoded


def missing_vibe_keys(vibes: list[VibeSpec], model: str, cache: VibeCache) -> list[str]:
    """Cache keys that still need an encode call, without counting the same vibe twice."""
    keys = dict.fromkeys(vibe_cache_key(v.image, model, v.information_extracted) for v in vibes)
    return [key for key in keys if not cache.has(key)]


def build_request(
    job: ImageJob,
    *,
    vibes: list[str] | None = None,
    image_bytes: bytes | None = None,
    seed: int | None = None,
) -> GenerateImageInfer:
    """Build the SDK request for ONE image.

    ``vibes`` are encoded vibe strings; when omitted a placeholder is used so the object
    can be priced. ``image_bytes`` avoids re-encoding the initial image (it is built once
    for the price estimate and once per generated image). ``seed`` overrides ``job.seed``.
    """
    # While the request is only being priced the real vibe strings do not exist yet; a non-empty
    # placeholder list makes the SDK count the vibes in ``calculate_cost``. The real call always
    # passes the encoded strings, so the placeholder never reaches NovelAI.
    common: dict[str, Any] = {
        "model": job.model,
        "width": job.size[0],
        "height": job.size[1],
        "negative_prompt": job.negative_prompt,
        "ucPreset": job.uc_preset,
        "steps": job.steps,
        "seed": seed if seed is not None else job.seed,
        "sampler": job.sampler,
        "character_prompts": _characters(job),
        "reference_image_multiple": vibes if vibes is not None else [_VIBE_PLACEHOLDER] * len(job.vibes),
        "reference_strength_multiple": [v.strength for v in job.vibes],
        "reference_information_extracted_multiple": [v.information_extracted for v in job.vibes],
        "qualityToggle": job.quality_toggle,
        "decrisp_mode": job.decrisp_mode,
        "variety_boost": job.variety_boost,
        "add_original_image": job.add_original_image,
    }
    common = {k: v for k, v in common.items() if v is not None}

    if job.action == GENERATE:
        gen = GenerateImageInfer.build_generate(
            prompt=job.prompt,
            use_trial=False,
            transparent_background=job.transparent_background,
            character_references=_character_references(job),
            **common,
        )
    elif job.action == INFILL:
        # The SDK defaults "overlay original image" to on, which leaves visible seams along a
        # hard mask edge (seen in a live V4.5 test); off unless the caller asks for it.
        infill = {**common, "add_original_image": bool(job.add_original_image)}
        gen = GenerateImageInfer.build_infill(
            prompt=job.prompt,
            image=image_bytes if image_bytes is not None else _source_png(job),
            mask=job.mask or b"",
            strength=job.strength,
            **infill,
        )
    else:
        # An unset extra_noise_seed stays None: the SDK then falls back to ``seed`` for
        # img2img, which is exactly the web client's behaviour.
        gen = GenerateImageInfer.build_img2img(
            prompt=job.prompt,
            image=image_bytes if image_bytes is not None else _source_png(job),
            strength=job.strength,
            noise=job.noise,
            extra_noise_seed=job.extra_noise_seed,
            use_trial=False,
            **common,
        )

    # Always one image per NovelAI call: Opus generates a single image for free, while the
    # second and later images of one call cost Anlas. A request for n images becomes n calls.
    gen.parameters.n_samples = 1
    if job.scale is not None:
        gen.parameters.scale = job.scale
    if job.cfg_rescale is not None:
        gen.parameters.cfg_rescale = job.cfg_rescale
    if job.noise_schedule is not None:
        gen.parameters.noise_schedule = NoiseSchedule(job.noise_schedule)
    return gen


def _source_png(job: ImageJob) -> bytes:
    if job.image is None:
        raise ValueError("img2img/infill requires an initial image")
    return as_png_rgb(job.image, job.size)


def _characters(job: ImageJob) -> list[Character] | None:
    if not job.characters:
        return None
    return [
        Character(
            prompt=c["prompt"],
            uc=c["uc"],
            center=c["center"] if c["center"] is not None else PositionMap.AUTO,
        )
        for c in job.characters
    ]


def _character_references(job: ImageJob) -> list[CharacterReference] | None:
    if not job.character_references:
        return None
    return [
        CharacterReference(
            image=ref.image,
            description=ref.description,
            strength=ref.strength,
            fidelity=ref.fidelity,
            information_extracted=ref.information_extracted,
        )
        for ref in job.character_references
    ]
