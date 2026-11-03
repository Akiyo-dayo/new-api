"""Shared fixtures: an offline ASGI client and fake NovelAI calls.

Nothing here touches the network: ``GenerateImageInfer.request`` and ``EncodeVibe.request``
are replaced by recorders, so the tests assert on the objects the adapter builds.
"""

from __future__ import annotations

import base64
import io
import types

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app import main
from app.build import VibeCache
from app.config import settings

TOKEN = "test-token-do-not-log"


def png(size: tuple[int, int] = (64, 64), color: tuple[int, int, int] = (10, 20, 30), mode: str = "RGB") -> bytes:
    image = Image.new(mode, size, color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def data_url(raw: bytes) -> str:
    return "data:image/png;base64," + b64(raw)


class Recorder:
    """Captured SDK calls: the built requests and how often they ran."""

    def __init__(self) -> None:
        self.generate: list[object] = []
        self.vibes: list[object] = []
        self.files: list[tuple[str, bytes]] | None = None

    @property
    def gen(self):
        assert self.generate, "no GenerateImageInfer.request call was captured"
        return self.generate[-1]

    @property
    def params(self):
        return self.gen.parameters


@pytest.fixture
def recorder(monkeypatch, tmp_path):
    rec = Recorder()
    rec.files = [("image_0.png", png((8, 8), (1, 2, 3)))]

    async def fake_generate(self, session, **kwargs):  # noqa: ANN001 - mirrors the SDK signature
        rec.generate.append(self)
        return types.SimpleNamespace(files=rec.files)

    async def fake_encode(self, session, **kwargs):  # noqa: ANN001
        rec.vibes.append(self)
        return types.SimpleNamespace(vibe_b64="ENCODED-VIBE")

    monkeypatch.setattr("novelai_python.sdk.ai.generate_image.GenerateImageInfer.request", fake_generate)
    monkeypatch.setattr("novelai_python.sdk.ai.encode_vibe.EncodeVibe.request", fake_encode)
    # Keep the cache inside tmp_path: /data does not exist in the test environment.
    monkeypatch.setattr(main, "vibe_cache", VibeCache(tmp_path / "vibes", settings.vibe_cache_max))
    return rec


@pytest.fixture(autouse=True)
def _fresh_queue(monkeypatch):
    """Every test starts with an empty lock table, no cost ceiling and NovelAI's own size range."""
    monkeypatch.setattr(main, "queues", main.TokenQueues(max_queue=settings.max_queue, timeout=5))
    monkeypatch.setattr(settings, "max_anlas_per_image", -1)
    monkeypatch.setattr(settings, "max_pixels", 2048 * 2048)
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://adapter") as http:
        yield http


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}
