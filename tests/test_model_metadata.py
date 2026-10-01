import asyncio
import json
from pathlib import Path

import pytest

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
        return mm.NOT_ON_CIVITAI

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


# --------------------------------------------------------------------------- #
# Automatic lookup of models a workflow uses, and the switch that stops it
# --------------------------------------------------------------------------- #

class _Prefs:
    def __init__(self, **prefs):
        self.prefs = prefs

    def get_prefs(self):
        return dict(self.prefs)


def _civitai(monkeypatch, env=None, **prefs):
    if env is None:
        monkeypatch.delenv(mm.ENV_ENABLE, raising=False)
    else:
        monkeypatch.setenv(mm.ENV_ENABLE, env)
    monkeypatch.setattr(mm, "_app_prefs", _Prefs(**prefs))


def _record_populates(monkeypatch):
    """Stub the hash + CivitAI lookup; return the list of paths it was asked for."""
    calls = []

    async def fake_populate(session, model_path, sub_type, sem):
        calls.append(Path(model_path).name)
        return True

    monkeypatch.setattr(mm, "_populate_model", fake_populate)
    return calls


async def _fetch_missing_and_wait(prefix, values):
    """Queue automatic lookups and wait for the background drain to finish."""
    result = await mm.fetch_missing(prefix, values)
    task = mm.missing_task(prefix)
    if task is not None:
        await task
    return result


def test_civitai_lookups_are_on_by_default(monkeypatch):
    _civitai(monkeypatch)
    assert mm.civitai_enabled() is True
    assert mm.civitai_status() == {"enabled": True, "forcedByEnvironment": False}


def test_civitai_lookups_follow_the_preference(monkeypatch):
    _civitai(monkeypatch, civitaiMetadataEnabled=False)
    assert mm.civitai_enabled() is False


def test_environment_overrides_the_preference(monkeypatch):
    _civitai(monkeypatch, env="0", civitaiMetadataEnabled=True)
    assert mm.civitai_status() == {"enabled": False, "forcedByEnvironment": True}
    _civitai(monkeypatch, env="1", civitaiMetadataEnabled=False)
    assert mm.civitai_status() == {"enabled": True, "forcedByEnvironment": True}


def test_unreadable_preferences_do_not_contact_civitai(monkeypatch):
    class Broken:
        def get_prefs(self):
            raise OSError("disk gone")

    monkeypatch.delenv(mm.ENV_ENABLE, raising=False)
    monkeypatch.setattr(mm, "_app_prefs", Broken())
    assert mm.civitai_enabled() is False


def test_the_preference_defaults_on():
    import mobile_app_prefs

    assert mobile_app_prefs._DEFAULTS[mm.PREF_KEY] is True


def test_resolve_model_value_stays_inside_the_roots(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    (root / "sub").mkdir(parents=True)
    (root / "sub" / "new.safetensors").write_bytes(b"x")
    (tmp_path / "outside.safetensors").write_bytes(b"x")
    (root / "notes.txt").write_text("x")
    _point_checkpoints_at(monkeypatch, root)

    found = mm.resolve_model_value("checkpoints", "sub\\new.safetensors")
    assert found is not None and Path(found[0]).name == "new.safetensors"
    assert found[1] == "checkpoint"
    assert mm.resolve_model_value("checkpoints", "../outside.safetensors") is None
    assert mm.resolve_model_value("checkpoints", "notes.txt") is None
    assert mm.resolve_model_value("checkpoints", "sub/missing.safetensors") is None
    assert mm.resolve_model_value("checkpoints", "") is None


def test_fetch_missing_looks_up_only_new_models(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    _civitai(monkeypatch)
    (root / "new.safetensors").write_bytes(b"x")
    known = root / "known.safetensors"
    known.write_bytes(b"x")
    _write_sidecar(known, civitai={"id": 1})
    unmatched = root / "homemade.safetensors"
    unmatched.write_bytes(b"x")
    _write_sidecar(unmatched, from_civitai=False, sha256="abc")
    calls = _record_populates(monkeypatch)

    result = asyncio.run(_fetch_missing_and_wait("checkpoints", [
        "new.safetensors",
        "new.safetensors",  # the same model in two widgets
        "known.safetensors",
        "homemade.safetensors",
        "../escape.safetensors",
        "gone.safetensors",
    ]))

    assert calls == ["new.safetensors"]
    assert result == {"queued": 1, "pending": 1}
    assert mm.missing_status("checkpoints") == {"pending": 0}


def test_fetch_missing_does_nothing_when_switched_off(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    (root / "new.safetensors").write_bytes(b"x")
    _civitai(monkeypatch, civitaiMetadataEnabled=False)
    calls = _record_populates(monkeypatch)

    result = asyncio.run(mm.fetch_missing("checkpoints", ["new.safetensors"]))

    assert result == {"error": "disabled"}
    assert calls == []


def test_fetch_all_does_nothing_when_switched_off(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    (root / "new.safetensors").write_bytes(b"x")
    _civitai(monkeypatch, env="0")
    calls = _record_populates(monkeypatch)

    result = asyncio.run(mm.fetch_all_civitai("checkpoints"))

    assert result == {"error": "disabled"}
    assert calls == []
    assert mm.get_fetch_status("checkpoints")["running"] is False


def test_fetch_missing_makes_the_new_file_listable(tmp_path: Path, monkeypatch):
    # The list is cached for a minute; a file added inside that minute must show
    # up once the frontend has asked about it.
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    _civitai(monkeypatch)
    mm.invalidate_list_cache()
    assert mm.list_models("checkpoints")["total"] == 0
    new = root / "new.safetensors"
    new.write_bytes(b"x")
    _write_sidecar(new, civitai={"id": 1})  # already identified: no lookup
    assert mm.list_models("checkpoints")["total"] == 0  # still cached

    asyncio.run(_fetch_missing_and_wait("checkpoints", ["new.safetensors"]))

    assert mm.list_models("checkpoints")["total"] == 1


def test_list_reports_models_civitai_does_not_know(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    mm.invalidate_list_cache()
    (root / "fresh.safetensors").write_bytes(b"x")
    homemade = root / "homemade.safetensors"
    homemade.write_bytes(b"x")
    _write_sidecar(homemade, from_civitai=False, sha256="abc")

    items = {i["file_name"]: i for i in mm.list_models("checkpoints")["items"]}

    assert items["fresh"]["from_civitai"] is None
    assert items["homemade"]["from_civitai"] is False


@pytest.mark.parametrize("bulk_first", [True, False])
@pytest.mark.parametrize("identified", [True, False])
def test_bulk_and_automatic_population_hash_a_shared_model_once(tmp_path, monkeypatch, bulk_first, identified):
    _point_checkpoints_at(monkeypatch, tmp_path)
    _civitai(monkeypatch)
    model = tmp_path / "new.safetensors"
    model.write_bytes(b"x")

    async def exercise():
        entered = asyncio.Event()
        release = asyncio.Event()
        hashes = []
        lookups = []
        async def hash_model(path):
            hashes.append(path)
            entered.set()
            await release.wait()
            return "abc"
        async def lookup(_session, sha256):
            lookups.append(sha256)
            return {"id": 1, "baseModel": "SDXL 1.0", "images": []} if identified else mm.NOT_ON_CIVITAI
        monkeypatch.setattr(mm, "_compute_sha256", hash_model)
        monkeypatch.setattr(mm, "_civitai_by_hash", lookup)
        async def bulk():
            return await mm.fetch_all_civitai("checkpoints")
        async def automatic():
            return await _fetch_missing_and_wait("checkpoints", ["new.safetensors"])
        first, second = (bulk, automatic) if bulk_first else (automatic, bulk)
        first_task = asyncio.create_task(first())
        await asyncio.wait_for(entered.wait(), timeout=1)
        second_task = asyncio.create_task(second())
        async def wait_for_second_worker():
            while mm._populate_locks[str(model.resolve())][1] != 2:
                await asyncio.sleep(0)
        await asyncio.wait_for(wait_for_second_worker(), timeout=1)
        release.set()
        await asyncio.gather(first_task, second_task)
        assert hashes == [str(model)]
        assert lookups == ["abc"]
        assert not mm._populate_locks
        assert mm._load_sidecar(str(model))["from_civitai"] is identified
    asyncio.run(exercise())


def test_cancelled_population_waiter_does_not_remove_an_active_lock(tmp_path, monkeypatch):
    model = tmp_path / "new.safetensors"
    model.write_bytes(b"x")
    async def exercise():
        entered = asyncio.Event()
        release = asyncio.Event()
        async def hash_model(_path):
            entered.set()
            await release.wait()
            return "abc"
        async def lookup(_session, _sha256):
            return mm.NOT_ON_CIVITAI
        monkeypatch.setattr(mm, "_compute_sha256", hash_model)
        monkeypatch.setattr(mm, "_civitai_by_hash", lookup)
        sem = asyncio.Semaphore(1)
        first = asyncio.create_task(mm._populate_model_once(None, str(model), "checkpoint", sem))
        await asyncio.wait_for(entered.wait(), timeout=1)
        waiter = asyncio.create_task(mm._populate_model_once(None, str(model), "checkpoint", sem))
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert mm._populate_locks[str(model.resolve())][1] == 1
        release.set()
        await first
        assert not mm._populate_locks
    asyncio.run(exercise())


def test_local_rescan_finds_new_files_with_civitai_disabled(tmp_path, monkeypatch):
    _point_checkpoints_at(monkeypatch, tmp_path)
    _civitai(monkeypatch, civitaiMetadataEnabled=False)
    mm.invalidate_list_cache()
    assert mm.list_models("checkpoints")["total"] == 0
    model = tmp_path / "new.safetensors"
    model.write_bytes(b"x")
    assert mm.list_models("checkpoints")["total"] == 0
    def must_not_lookup(*_args):
        raise AssertionError("a local rescan must not hash or contact CivitAI")
    monkeypatch.setattr(mm, "_compute_sha256", must_not_lookup)
    monkeypatch.setattr(mm, "_civitai_by_hash", must_not_lookup)
    assert mm.rescan_models("checkpoints") == 1
    assert mm.list_models("checkpoints")["items"][0]["file_name"] == "new"
    assert not Path(mm._sidecar_path(str(model))).exists()


def test_a_failed_lookup_is_not_recorded_as_a_miss(tmp_path: Path, monkeypatch):
    model = tmp_path / "new.safetensors"
    model.write_bytes(b"data")

    async def failed_lookup(_session, _sha):
        return None  # offline, rate-limited, a 5xx or a timeout: no answer at all

    monkeypatch.setattr(mm, "_civitai_by_hash", failed_lookup)
    updated = asyncio.run(mm._populate_model(None, str(model), "checkpoint", asyncio.Semaphore(1)))

    assert updated is False
    assert mm._load_sidecar(str(model)) is None, "a failed lookup must leave no sidecar"
    assert mm._needs_fetch(str(model)) is True, "the next pass must ask again"


class _Response:
    def __init__(self, status, body=None):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._body


class _Session:
    def __init__(self, response):
        self._response = response

    def get(self, _url, timeout=None):
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


@pytest.mark.parametrize("response, expected", [
    (_Response(200, {"id": 7}), {"id": 7}),
    (_Response(404), "not on civitai"),
    (_Response(429), None),
    (_Response(503), None),
    (OSError("network is unreachable"), None),
])
def test_only_civitais_404_means_the_model_is_not_there(monkeypatch, response, expected):
    import sys
    import types
    if "aiohttp" not in sys.modules or not hasattr(sys.modules["aiohttp"], "ClientTimeout"):
        monkeypatch.setitem(sys.modules, "aiohttp", types.SimpleNamespace(ClientTimeout=lambda **_: None))
    result = asyncio.run(mm._civitai_by_hash(_Session(response), "abc"))
    if expected == "not on civitai":
        assert result is mm.NOT_ON_CIVITAI
    else:
        assert result == expected


def test_fetch_missing_returns_before_the_lookups_finish(tmp_path: Path, monkeypatch):
    # Hashing a multi-GB checkpoint takes a while; the request that asks for it
    # must not wait, and the frontend polls missing_status instead.
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    _civitai(monkeypatch)
    (root / "a.safetensors").write_bytes(b"x")
    (root / "b.safetensors").write_bytes(b"x")

    async def exercise():
        release = asyncio.Event()
        started = []

        async def slow_populate(session, model_path, sub_type, sem):
            started.append(Path(model_path).name)
            await release.wait()
            return True

        monkeypatch.setattr(mm, "_populate_model", slow_populate)
        first = await asyncio.wait_for(mm.fetch_missing("checkpoints", ["a.safetensors"]), timeout=1)
        assert first == {"queued": 1, "pending": 1}
        # Asking again about a value already queued does not queue it twice;
        # a new one joins the same drain.
        again = await mm.fetch_missing("checkpoints", ["a.safetensors", "b.safetensors"])
        assert again == {"queued": 1, "pending": 2}
        assert mm.missing_status("checkpoints") == {"pending": 2}
        release.set()
        await mm.missing_task("checkpoints")
        assert sorted(started) == ["a.safetensors", "b.safetensors"]
        assert mm.missing_status("checkpoints") == {"pending": 0}

    asyncio.run(exercise())


def test_turning_civitai_off_stops_queued_lookups(tmp_path: Path, monkeypatch):
    root = tmp_path / "checkpoints"
    root.mkdir()
    _point_checkpoints_at(monkeypatch, root)
    _civitai(monkeypatch)
    (root / "a.safetensors").write_bytes(b"x")
    calls = _record_populates(monkeypatch)

    async def exercise():
        await mm.fetch_missing("checkpoints", ["a.safetensors"])
        monkeypatch.setenv(mm.ENV_ENABLE, "0")  # switched off before the drain runs
        await mm.missing_task("checkpoints")

    asyncio.run(exercise())
    assert calls == []
    assert mm.missing_status("checkpoints") == {"pending": 0}
