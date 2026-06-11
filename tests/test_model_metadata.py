import asyncio
import json
from pathlib import Path

import model_metadata as mm


def _point_checkpoints_at(monkeypatch, *roots):
    """Make folder_paths.get_folder_paths('checkpoints') return the given roots."""
    mapping = {"checkpoints": [str(r) for r in roots]}
    monkeypatch.setattr(
        mm.folder_paths,
        "get_folder_paths",
        lambda key: mapping.get(key, []),
        raising=False,
    )


def _write_sidecar(model_path: Path, **fields):
    sidecar = Path(mm._sidecar_path(str(model_path)))
    sidecar.write_text(json.dumps(fields), encoding="utf-8")
    return sidecar


def test_determine_base_model_maps_known_and_passthrough():
    assert mm.determine_base_model("illustrious") == "Illustrious"
    assert mm.determine_base_model("SDXL 1.0") == "SDXL 1.0"
    assert mm.determine_base_model("Pony") == "Pony"
    # Unknown civitai strings pass through verbatim.
    assert mm.determine_base_model("Some Future Model") == "Some Future Model"
    assert mm.determine_base_model(None) == "Unknown"


def test_list_models_reads_sidecar_and_falls_back(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    sub = root / "anime"
    sub.mkdir(parents=True)
    _point_checkpoints_at(monkeypatch, root)

    # Model WITH an LM-style sidecar (identified).
    identified = sub / "cool_model.safetensors"
    identified.write_bytes(b"x")
    _write_sidecar(
        identified,
        model_name="Cool Model",
        base_model="Illustrious",
        sub_type="checkpoint",
        sha256="abc123",
        preview_nsfw_level=4,
        civitai={"id": 42, "modelId": 7, "name": "v2.0"},
    )

    # Model WITHOUT a sidecar (fallback to filename).
    bare = root / "mystery.safetensors"
    bare.write_bytes(b"y")

    result = mm.list_models("checkpoints", page=1, page_size=50)
    assert result["total"] == 2
    by_name = {item["file_name"]: item for item in result["items"]}

    cool = by_name["cool_model"]
    assert cool["model_name"] == "Cool Model"
    assert cool["base_model"] == "Illustrious"
    assert cool["folder"] == "anime"
    assert cool["preview_nsfw_level"] == 4
    assert cool["civitai"] == {"id": 42, "modelId": 7, "name": "v2.0"}
    assert cool["file_path"].endswith("anime/cool_model.safetensors")

    mystery = by_name["mystery"]
    assert mystery["model_name"] == "mystery"  # filename fallback
    assert mystery["base_model"] == "Unknown"
    assert mystery["folder"] == ""
    assert mystery["civitai"] is None


def test_list_models_finds_sibling_preview(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    model = root / "withpreview.safetensors"
    model.write_bytes(b"x")
    (root / "withpreview.webp").write_bytes(b"img")

    item = mm.list_models("checkpoints")["items"][0]
    assert item["preview_url"].startswith(mm.PREVIEW_ROUTE + "?path=")
    assert "withpreview.webp" in item["preview_url"]


def test_list_models_returns_isolated_copies(tmp_path: Path, monkeypatch):
    # A caller mutating a returned item must not corrupt the shared cache.
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    (root / "m.safetensors").write_bytes(b"x")

    first = mm.list_models("checkpoints")["items"][0]
    first["model_name"] = "MUTATED"
    first["civitai"] = {"injected": True}

    second = mm.list_models("checkpoints")["items"][0]  # served from cache
    assert second["model_name"] != "MUTATED"
    assert second["civitai"] is None


def test_needs_fetch(tmp_path: Path):
    model = tmp_path / "m.safetensors"
    model.write_bytes(b"x")

    # No sidecar -> needs fetching.
    assert mm._needs_fetch(str(model)) is True

    # Identified -> skip.
    _write_sidecar(model, sha256="h", civitai={"id": 1})
    assert mm._needs_fetch(str(model)) is False

    # Checked and confirmed absent from Civitai -> skip (don't re-hash).
    _write_sidecar(model, sha256="h", from_civitai=False, civitai=None)
    assert mm._needs_fetch(str(model)) is False

    # Has sidecar but never checked -> needs fetching.
    _write_sidecar(model, model_name="x")
    assert mm._needs_fetch(str(model)) is True

    # Already enriched elsewhere (e.g. a Lora Manager sidecar): a known base
    # model plus a resolvable preview -> skip, so the force=False refresh doesn't
    # re-hash a model that already has metadata.
    preview = model.parent / "m.webp"
    preview.write_bytes(b"img")
    _write_sidecar(model, model_name="x", base_model="SDXL 1.0")
    assert mm._needs_fetch(str(model)) is False

    # Base model but no resolvable preview -> still fetch (so we can grab one).
    preview.unlink()
    _write_sidecar(model, model_name="x", base_model="SDXL 1.0")
    assert mm._needs_fetch(str(model)) is True


def test_is_within_model_roots(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    (root / "sub").mkdir(parents=True)
    _point_checkpoints_at(monkeypatch, root)
    assert mm.is_within_model_roots(str(root / "sub" / "a.webp")) is True
    assert mm.is_within_model_roots(str(tmp_path / "outside.webp")) is False


def test_populate_model_writes_lm_compatible_sidecar(tmp_path: Path, monkeypatch):
    model = tmp_path / "newmodel.safetensors"
    model.write_bytes(b"hello world")

    civitai_payload = {
        "id": 999,
        "modelId": 100,
        "name": "v3.0",
        "baseModel": "Pony",
        "model": {"name": "My Fancy Model"},
        "images": [{"url": "https://example/p.jpg", "type": "image", "nsfwLevel": 1}],
    }

    async def fake_lookup(_session, _sha):
        return civitai_payload

    async def fake_download(_session, _url, _type, model_path, sidecar):
        sidecar["preview_url"] = str(Path(model_path).with_suffix("")) + ".webp"

    monkeypatch.setattr(mm, "_civitai_by_hash", fake_lookup)
    monkeypatch.setattr(mm, "_download_preview", fake_download)

    sem = asyncio.Semaphore(1)
    updated = asyncio.run(
        mm._populate_model(None, str(model), "checkpoint", sem)
    )
    assert updated is True

    sidecar = json.loads(
        (tmp_path / "newmodel.metadata.json").read_text(encoding="utf-8")
    )
    assert sidecar["model_name"] == "My Fancy Model"
    assert sidecar["base_model"] == "Pony"
    assert sidecar["sub_type"] == "checkpoint"
    assert sidecar["from_civitai"] is True
    assert sidecar["civitai"]["id"] == 999
    assert sidecar["preview_nsfw_level"] == 1
    assert sidecar["sha256"]  # a real hash was computed
    assert sidecar["preview_url"].endswith("newmodel.webp")


def test_populate_model_records_unmatched(tmp_path: Path, monkeypatch):
    model = tmp_path / "unknown.safetensors"
    model.write_bytes(b"data")

    async def fake_lookup(_session, _sha):
        return None  # not on Civitai

    monkeypatch.setattr(mm, "_civitai_by_hash", fake_lookup)

    sem = asyncio.Semaphore(1)
    updated = asyncio.run(
        mm._populate_model(None, str(model), "checkpoint", sem)
    )
    assert updated is False

    sidecar = json.loads(
        (tmp_path / "unknown.metadata.json").read_text(encoding="utf-8")
    )
    # Recorded as checked so future passes skip it.
    assert sidecar["from_civitai"] is False
    assert sidecar["sha256"]
    assert sidecar["civitai"] is None
    assert mm._needs_fetch(str(model)) is False


def test_diffusion_model_subtype_override(tmp_path: Path, monkeypatch):
    model = tmp_path / "wan.safetensors"
    model.write_bytes(b"x")

    async def fake_lookup(_session, _sha):
        return {
            "id": 1,
            "modelId": 2,
            "name": "v1",
            "baseModel": "Qwen",  # in DIFFUSION_MODEL_BASE_MODELS
            "model": {"name": "Qwen Thing"},
            "images": [],
        }

    monkeypatch.setattr(mm, "_civitai_by_hash", fake_lookup)
    sem = asyncio.Semaphore(1)
    asyncio.run(mm._populate_model(None, str(model), "checkpoint", sem))

    sidecar = json.loads(
        (tmp_path / "wan.metadata.json").read_text(encoding="utf-8")
    )
    assert sidecar["sub_type"] == "diffusion_model"
