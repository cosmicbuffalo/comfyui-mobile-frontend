import json
import sys
import uuid
from types import ModuleType, SimpleNamespace

import pytest

import mobile_app_prefs as prefs
import mobile_telemetry as telemetry

HOUR = telemetry.HOUR_SECONDS


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Isolated prefs and identity files, telemetry state reset, env cleared."""
    prefs_path = tmp_path / "mobile" / "preferences.json"
    monkeypatch.setattr(prefs, "_prefs_path", lambda: str(prefs_path))
    monkeypatch.setattr(prefs, "_mobile_dir", lambda: str(prefs_path.parent))
    monkeypatch.setattr(prefs, "_prefs", None)
    identity = tmp_path / "mobile" / "telemetry.json"
    monkeypatch.setattr(telemetry, "_identity_path", lambda: str(identity))
    monkeypatch.setattr(telemetry, "_identity", None)
    telemetry._prompt_families.clear()
    monkeypatch.delenv(telemetry.ENV_ENABLE, raising=False)
    monkeypatch.delenv(telemetry.ENV_DEPLOYMENT, raising=False)
    telemetry._queue.clear()
    telemetry._reset_hour(now=0)
    return identity


@pytest.fixture
def sent(monkeypatch):
    """Capture relay POSTs instead of making them."""
    calls = []

    class Response:
        status_code = 202

    def fake_post(url, json=None, timeout=None):
        calls.append({"url": url, "json": json})
        return Response()

    monkeypatch.setattr(telemetry, "_REQUESTS_AVAILABLE", True)
    monkeypatch.setattr(telemetry.requests, "post", fake_post, raising=False)
    return calls


def run(status="success", seconds=4, error=None):
    """A ComfyUI history entry for one finished run."""
    kind = {"success": "execution_success", "error": "execution_error",
            "interrupted": "execution_interrupted"}[status]
    end = {"timestamp": 1_000 + seconds * 1000}
    if error:
        end.update(exception_type=error,
                   exception_message="CUDA out of memory while sampling 'a red fox in fresh snow'")
    return {"status": {"status_str": status if status != "interrupted" else "error",
                       "messages": [["execution_start", {"timestamp": 1_000}], [kind, end]]},
            "outputs": {}}


def hourly(batch):
    return next(e["properties"] for e in batch["events"] if e["event"] == "hourly summary")


# -- on by default, off when asked ---------------------------------------------------

def test_a_fresh_install_is_on(home, sent):
    assert telemetry.is_enabled() is True
    telemetry.record_started()
    batch = telemetry.flush_once(now=1)
    assert [e["event"] for e in batch["events"]] == ["node started"]
    assert home.exists()


def test_switched_off_it_records_nothing_and_writes_nothing(home, sent, monkeypatch):
    monkeypatch.setenv(telemetry.ENV_ENABLE, "0")
    telemetry.record_started()
    telemetry.note_frontend_open("web")
    telemetry.record_prompt_finished(run())
    assert telemetry.flush_once(now=HOUR + 1) is None
    assert sent == []
    assert not home.exists(), "an install id was minted while telemetry was off"


def test_the_environment_wins_over_the_preference_both_ways(home, monkeypatch):
    prefs.set_prefs({telemetry.PREF_KEY: True})
    monkeypatch.setenv(telemetry.ENV_ENABLE, "0")
    assert telemetry.is_enabled() is False
    prefs.set_prefs({telemetry.PREF_KEY: False})
    monkeypatch.setenv(telemetry.ENV_ENABLE, "1")
    assert telemetry.is_enabled() is True
    assert telemetry.status()["forcedByEnvironment"] is True


def test_turning_it_off_deletes_the_install_id_the_queue_and_the_hour(home, sent):
    telemetry.record_started()
    telemetry.record_prompt_finished(run())
    first_id = json.loads(home.read_text())["install_id"]

    prefs.set_prefs({telemetry.PREF_KEY: False})
    telemetry.flush_once(now=HOUR + 1)
    assert not home.exists()
    assert len(telemetry._queue) == 0
    assert sum(telemetry._hour["outcomes"].values()) == 0
    assert sent == []

    prefs.set_prefs({telemetry.PREF_KEY: True})
    telemetry.record_started()
    assert json.loads(home.read_text())["install_id"] != first_id, \
        "re-enabling resumed the old identity instead of starting a new one"


# -- activity is sent once an hour, as ranges --------------------------------------

def test_activity_waits_for_the_hour_and_goes_as_one_summary(home, sent):
    for _ in range(7):
        telemetry.note_frontend_open("ios_app")
    for _ in range(3):
        telemetry.note_prompt_queued("web")
    for _ in range(12):
        telemetry.record_prompt_finished(run(seconds=4))
    telemetry.record_prompt_finished(run("error", seconds=40, error="torch.OutOfMemoryError"))
    telemetry.record_push_result("app", {"sent": 1, "pruned": 0, "total": 1})

    assert telemetry.flush_once(now=HOUR - 1) is None, "sent before the hour was up"
    summary = hourly(telemetry.flush_once(now=HOUR + 1))
    assert summary["opens_ios_app_bucket"] == "6-20"
    assert summary["opens_web_bucket"] == "0"
    assert summary["queued_web_bucket"] == "3-5"
    assert summary["succeeded_bucket"] == "6-20"
    assert summary["failed_bucket"] == "1-2"
    assert summary["median_duration_bucket"] == "2-10s"
    assert summary["top_error_class"] == "OutOfMemoryError"
    assert summary["pushes_delivered_bucket"] == "1-2"
    assert len(sent) == 1, "a busy hour must still be one relay call"


def test_an_idle_hour_sends_nothing(home, sent):
    assert telemetry.flush_once(now=HOUR + 1) is None
    assert sent == []


def test_a_busy_install_calls_the_relay_once_an_hour_at_most(home, sent):
    for minute in range(1, 3 * 60 + 1):
        telemetry.record_prompt_finished(run())
        telemetry.note_frontend_open("web")
        telemetry.flush_once(now=minute * 60)
    assert len(sent) == 3


def test_the_error_message_and_prompt_never_leave(home, sent):
    telemetry.record_prompt_finished(run("error", error="torch.OutOfMemoryError"))
    telemetry.flush_once(now=HOUR + 1)
    assert "fox" not in json.dumps(sent).lower()
    assert hourly(sent[0]["json"])["top_error_class"] == "OutOfMemoryError"


def test_the_most_used_family_that_hour_is_reported(home, sent):
    for index, family in enumerate(["sdxl", "flux", "sdxl"]):
        prompt_id = f"prompt-{index}"
        telemetry._prompt_families[prompt_id] = family
        telemetry.record_prompt_finished(run(), prompt_id=prompt_id)
    assert hourly(telemetry.flush_once(now=HOUR + 1))["top_model_family"] == "sdxl"
    assert not telemetry._prompt_families


def test_runs_without_a_diffusion_model_report_no_family(home, sent):
    telemetry.record_prompt_finished(run())
    assert "top_model_family" not in hourly(telemetry.flush_once(now=HOUR + 1))


@pytest.fixture
def model_loader(monkeypatch):
    calls = []
    def load(models, *args, **kwargs):
        calls.append((models, args, kwargs))
        return "loaded"
    comfy = ModuleType("comfy")
    management = ModuleType("comfy.model_management")
    management.load_models_gpu = load
    # A previous run's resident model must never be used for attribution.
    management.current_loaded_models = [_model("SDXL")]
    comfy.model_management = management
    execution = ModuleType("comfy_execution")
    utils = ModuleType("comfy_execution.utils")
    context = SimpleNamespace(prompt_id="prompt-a")
    utils.get_executing_context = lambda: context
    execution.utils = utils
    for name, module in (("comfy", comfy), ("comfy.model_management", management),
                         ("comfy_execution", execution), ("comfy_execution.utils", utils)):
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(telemetry, "_model_family_tracking_installed", False)
    assert telemetry.install_model_family_tracking() is True
    assert telemetry.install_model_family_tracking() is False
    return management, context, calls


def _model(config_name=None):
    base = SimpleNamespace()
    if config_name:
        base.model_config = type(config_name, (), {})()
    return SimpleNamespace(model=base)


def test_model_family_belongs_to_the_finished_prompt_not_the_next_run(home, sent, model_loader):
    loader, context, calls = model_loader
    models = [_model("Flux"), _model()]
    assert loader.load_models_gpu(models, 123, force_full_load=True) == "loaded"
    assert calls == [(models, (123,), {"force_full_load": True})]
    loader.load_models_gpu([_model()])  # VAE decode must preserve Flux.
    context.prompt_id = "prompt-b"
    loader.load_models_gpu([_model("WAN22_T2V")])
    # Polling can discover A only after B has loaded its different model.
    telemetry.record_prompt_finished(run(), prompt_id="prompt-a")
    assert telemetry._hour["families"] == {"flux": 1}
    assert telemetry._prompt_families == {"prompt-b": "wan"}


def test_image_only_prompt_does_not_inherit_a_resident_model(home, sent, model_loader):
    loader, context, _calls = model_loader
    loader.load_models_gpu([_model("Flux")])
    context.prompt_id = "image-only"
    loader.load_models_gpu([_model()])
    telemetry.record_prompt_finished(run(), prompt_id="image-only")
    assert "top_model_family" not in hourly(telemetry.flush_once(now=HOUR + 1))
    assert telemetry._prompt_families == {"prompt-a": "flux"}


def test_model_family_is_omitted_without_an_execution_context(home, model_loader):
    loader, context, _calls = model_loader
    context.prompt_id = None
    loader.load_models_gpu([_model("Flux")])
    assert not telemetry._prompt_families


def test_tracking_failure_cannot_break_model_loading(home, model_loader, monkeypatch):
    loader, _context, _calls = model_loader
    def broken(_models):
        raise RuntimeError("telemetry failed")
    monkeypatch.setattr(telemetry, "_record_loaded_model_family", broken)
    assert loader.load_models_gpu([_model("Flux")]) == "loaded"


def test_prompt_family_tracking_is_bounded_and_cleared_when_disabled(home, model_loader):
    loader, context, _calls = model_loader
    for index in range(telemetry.MAX_QUEUE + 1):
        context.prompt_id = f"prompt-{index}"
        loader.load_models_gpu([_model("Flux")])
    assert len(telemetry._prompt_families) == telemetry.MAX_QUEUE
    assert "prompt-0" not in telemetry._prompt_families
    telemetry.forget()
    assert not telemetry._prompt_families


# -- nothing outside the contract leaves -------------------------------------------

def test_unknown_events_and_properties_never_reach_a_batch(home, sent):
    telemetry.record("prompt text captured", prompt="a red fox in fresh snow")
    telemetry.record("node started", platform="linux", prompt="a red fox in fresh snow",
                     server_url="http://192.168.1.76:8188")
    batch = telemetry.flush_once(now=1)
    assert [e["event"] for e in batch["events"]] == ["node started"]
    assert set(batch["events"][0]["properties"]) == {"platform", "node_version", "measurement_version"}
    assert "fox" not in json.dumps(sent).lower()
    assert "192.168" not in json.dumps(sent)


def test_a_value_that_breaks_its_rule_is_dropped(home):
    telemetry.record("node started", platform="solaris", python_version="three")
    props = telemetry.take_batch()["events"][0]["properties"]
    assert "platform" not in props and "python_version" not in props


# -- the batch itself ----------------------------------------------------------------

def test_a_batch_carries_a_random_install_id_and_the_deployment(home, sent, monkeypatch):
    monkeypatch.setenv(telemetry.ENV_DEPLOYMENT, "review")
    telemetry.record_started()
    telemetry.flush_once(now=1)
    body = sent[0]["json"]
    assert sent[0]["url"] == telemetry.RELAY_URL
    assert uuid.UUID(body["install_id"]).version == 4
    assert body["deployment"] == "review"


def test_an_unknown_deployment_falls_back_to_prod(home, monkeypatch):
    monkeypatch.setenv(telemetry.ENV_DEPLOYMENT, "staging")
    assert telemetry.deployment() == "prod"


def test_a_failing_relay_is_silent_and_nothing_is_retried(home, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("relay unreachable")

    monkeypatch.setattr(telemetry, "_REQUESTS_AVAILABLE", True)
    monkeypatch.setattr(telemetry.requests, "post", boom, raising=False)
    telemetry.record_started()
    telemetry.flush_once(now=1)  # must not raise
    assert len(telemetry._queue) == 0


def test_a_daily_summary_says_the_install_is_alive(home, sent):
    telemetry.record_started()
    telemetry.flush_once(now=1)
    identity = json.loads(home.read_text())
    batch = telemetry.flush_once(now=identity["last_summary_at"] + telemetry.SUMMARY_INTERVAL_SECONDS + 1)
    summary = next(e for e in batch["events"] if e["event"] == "daily summary")
    assert set(summary["properties"]) >= {"paired_app", "days_since_install_bucket"}


# -- small helpers -------------------------------------------------------------------

@pytest.mark.parametrize("ua,expected", [
    ("Mozilla/5.0 (iPhone) Safari/604.1 CueForgeiOS/1.0.0 (ios)", "ios_app"),
    ("CueForgeShareExtension/1.0.0 CueForgeiOS", "share_extension"),
    ("Mozilla/5.0 (Macintosh) Chrome/140", "web"),
    (None, "web"),
])
def test_surface_comes_from_the_app_user_agent_marker(ua, expected):
    assert telemetry.surface_from_user_agent(ua) == expected


@pytest.mark.parametrize("n,bucket", [(0, "0"), (1, "1-2"), (2, "1-2"), (3, "3-5"), (5, "3-5"), (6, "6-20"), (20, "6-20"), (100, "21-100"), (101, "101+")])
def test_count_buckets(n, bucket):
    assert telemetry.bucket_count(n) == bucket


@pytest.mark.parametrize("config,family", [
    ("SDXL", "sdxl"), ("SDXLRefiner", "sdxl"), ("SD15_instructpix2pix", "sd15"),
    ("SD21UnclipH", "sd2"), ("Flux2", "flux2"), ("FluxSchnell", "flux"),
    ("WAN22_T2V", "wan"), ("LTXAV", "ltx"), ("HunyuanVideo15", "hunyuan_video"),
    ("HunyuanImage21", "hunyuan_image"), ("Hunyuan3Dv2", "3d"), ("ACEStep15", "audio"),
    ("SD_X4Upscaler", "other"), ("SomeFutureModel", "other"),
])
def test_model_family_maps_comfyuis_architecture_names(config, family):
    assert telemetry.family_from_config_name(config) == family


def test_every_mapped_family_is_one_the_contract_allows():
    allowed = telemetry._CONTRACT["hourly summary"]["top_model_family"].values
    produced = {family for _, family in telemetry._FAMILY_PREFIXES} | {"other"}
    assert produced <= allowed, f"mapped but not in the contract: {sorted(produced - allowed)}"


# -- /mobile 5xx counting --------------------------------------------------------------

class _HTTPException(Exception):
    def __init__(self, status):
        super().__init__(status)
        self.status = status


# Just what the middleware touches; the suite stubs aiohttp itself.
_web = SimpleNamespace(middleware=lambda f: f, HTTPException=_HTTPException)


@pytest.mark.parametrize("outcome, counted", [
    ("ok", 0),
    ("returned_503", 1),
    ("raised_500", 1),   # an HTTPInternalServerError, raised rather than returned
    ("raised_404", 0),   # a client error is not a server failure
    ("crashed", 1),
])
def test_the_error_middleware_counts_server_failures_however_they_surface(home, outcome, counted):
    import asyncio

    async def handler(request):
        if outcome == "raised_500":
            raise _HTTPException(500)
        if outcome == "raised_404":
            raise _HTTPException(404)
        if outcome == "crashed":
            raise RuntimeError("boom")
        return SimpleNamespace(status=503 if outcome == "returned_503" else 200)

    middleware = telemetry.make_error_middleware(_web)
    try:
        asyncio.run(middleware(SimpleNamespace(), handler))
    except (_HTTPException, RuntimeError):
        pass
    assert telemetry._hour["request_failures"] == counted
