"""Operational telemetry, sent through the CueForge relay.

**On by default, and easy to turn off.** The server's operator switches it off
in Preferences (`telemetryEnabled`, server-wide) or with
`COMFYUI_MOBILE_TELEMETRY=0`, which wins over the preference; `=1` forces it
on. Turning it off deletes the install id and drops anything queued.

What it is for: seeing how the node actually runs on real servers - that it
starts, whether generations finish or fail and roughly how long they take,
whether notifications get delivered, which routes error. Not who uses it, and
not what they make: no prompts, workflows or their names, model or output
filenames, server address, or anything about the people using the server.

Events go to the relay's `/telemetry/batch` endpoint, never straight to an
analytics service, so no ingestion key lives in this public repository and the
server's IP never reaches PostHog. The relay checks every field against the
same contract as `_CONTRACT` below; a key either side does not list is dropped.
CUEFORGE_PRIVACY.md documents every field.

Structurally unable to break the node: every entry point swallows its own
errors, the queue is bounded, and sends run in an executor off the event loop.
"""
import collections
import functools
import json
import math
import os
import re
import statistics
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

import folder_paths

from json_cache_io import atomic_write_json
from mobile_capabilities import NODE_VERSION

try:
    import requests
    _REQUESTS_AVAILABLE = True
except Exception:  # pragma: no cover - optional runtime dependency
    requests = None
    _REQUESTS_AVAILABLE = False

try:
    import mobile_app_prefs as _app_prefs
except Exception:  # pragma: no cover - module should always be importable
    _app_prefs = None

_LOG_PREFIX = "[\033[34mMobile Telemetry\033[0m]"

ENV_ENABLE = "COMFYUI_MOBILE_TELEMETRY"
ENV_DEPLOYMENT = "COMFYUI_MOBILE_TELEMETRY_DEPLOYMENT"
RELAY_URL = "https://comfyui-mobile-frontend-push.cosmicbuffalo.workers.dev/telemetry/batch"
PREF_KEY = "telemetryEnabled"

MEASUREMENT_VERSION = 1
FLUSH_INTERVAL_SECONDS = 60
SUMMARY_INTERVAL_SECONDS = 24 * 60 * 60
MAX_QUEUE = 500
MAX_BATCH = 50

# -- contract -----------------------------------------------------------------
# telemetry_contract.json is a copy of cueforge-telemetry's contract.json, the
# file the relay validates against. Building the rules from it means the node
# never queues a field the relay would drop. tests/test_telemetry_contract_copy.py
# fails if the copy drifts from the source.

_CONTRACT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "telemetry_contract.json")
with open(_CONTRACT_PATH, encoding="utf-8") as _f:
    CONTRACT_SPEC = json.load(_f)

_PATTERNS = {name: re.compile(source) for name, source in CONTRACT_SPEC["patterns"].items()}
COUNT_BUCKETS = tuple(CONTRACT_SPEC["buckets"]["count"])
DURATION_BUCKETS = tuple(CONTRACT_SPEC["buckets"]["duration"])
DAYS_BUCKETS = tuple(CONTRACT_SPEC["buckets"]["days"])


def _version(v):
    return isinstance(v, str) and bool(_PATTERNS["version"].match(v))


def _type_name(v):
    return isinstance(v, str) and bool(_PATTERNS["type_name"].match(v))


def _rule(spec):
    """A validator for one contract rule. Fixed-value rules expose `.values`
    (and buckets `.is_bucket`) for tests/test_privacy_doc_contract.py."""
    kind = spec["type"]
    if kind in ("enum", "bucket"):
        values = frozenset(spec["values"] if kind == "enum" else CONTRACT_SPEC["buckets"][spec["bucket"]])
        check = lambda v: isinstance(v, str) and v in values  # noqa: E731
        check.values = values
        check.is_bucket = kind == "bucket"
        return check
    if kind == "version":
        also = frozenset(spec.get("also", ()))
        return lambda v: isinstance(v, str) and (v in also or _version(v))
    if kind == "type_name":
        return _type_name
    if kind == "bool":
        return lambda v: isinstance(v, bool)
    if kind == "int":
        low, high = spec["min"], spec["max"]
        return lambda v: isinstance(v, int) and not isinstance(v, bool) and low <= v <= high
    raise ValueError(f"unknown contract rule type: {kind}")


_COMMON = {name: _rule(spec) for name, spec in CONTRACT_SPEC["common"].items()}
_CONTRACT = {
    event: {name: _rule(spec) for name, spec in fields.items()}
    for event, fields in CONTRACT_SPEC["events"].items()
}


def allowed_properties(event, properties):
    """The subset of `properties` the contract allows for `event`, or None when
    the event itself is unknown."""
    rules = _CONTRACT.get(event)
    if rules is None:
        return None
    rules = {**_COMMON, **rules}
    return {k: v for k, v in (properties or {}).items() if k in rules and rules[k](v)}


# -- buckets --------------------------------------------------------------------

def bucket_count(n):
    if not isinstance(n, (int, float)) or n <= 0:
        return "0"
    if n <= 2:
        return "1-2"
    if n <= 5:
        return "3-5"
    if n <= 20:
        return "6-20"
    if n <= 100:
        return "21-100"
    return "101+"


def bucket_duration(seconds):
    if not isinstance(seconds, (int, float)) or math.isnan(seconds) or seconds < 2:
        return "<2s"
    if seconds < 10:
        return "2-10s"
    if seconds < 30:
        return "10-30s"
    if seconds < 120:
        return "30s-2m"
    if seconds < 600:
        return "2-10m"
    return "10m+"


def bucket_days(days):
    if days < 1:
        return "0"
    if days < 7:
        return "1-6"
    if days < 30:
        return "7-29"
    if days < 90:
        return "30-89"
    return "90+"


# -- consent and identity -------------------------------------------------------

_lock = threading.Lock()
_queue = collections.deque(maxlen=MAX_QUEUE)
_identity = None  # cached {"install_id", "installed_at", "last_summary_at"}
# Architecture observed during this prompt's execution, never inferred from
# global GPU residency at completion. Bounded in case history is cleared before
# the completion watcher consumes an entry.
_prompt_families = collections.OrderedDict()
_model_family_tracking_installed = False
HOUR_SECONDS = 60 * 60


def _new_hour(now=None):
    """What happened since the last hourly summary. Never sent as it happens:
    this is the whole of the activity telemetry, rolled up once an hour."""
    return {
        "started": time.time() if now is None else now,
        "opens": collections.Counter(),      # surface -> page loads
        "queued": collections.Counter(),     # surface -> accepted prompts
        "outcomes": collections.Counter(),   # success / error / interrupted
        "durations": [],                     # seconds, for the median only
        "families": collections.Counter(),   # model family -> runs
        "errors": collections.Counter(),     # exception type name -> runs
        "pushes": collections.Counter(),     # delivered / failed
        "request_failures": 0,
    }


_hour = _new_hour()


def env_override():
    """True/False when the environment decides, None when it leaves it to the
    preference."""
    value = os.environ.get(ENV_ENABLE)
    if value is None:
        return None
    value = value.strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return None


def is_enabled():
    try:
        forced = env_override()
        if forced is not None:
            return forced
        if _app_prefs is None:
            return False
        return _app_prefs.get_prefs().get(PREF_KEY, True) is not False
    except Exception:
        return False


_DEPLOYMENTS = tuple(CONTRACT_SPEC["deployments"])
MAX_BATCH = min(MAX_BATCH, CONTRACT_SPEC["limits"]["max_events"])


def deployment():
    value = (os.environ.get(ENV_DEPLOYMENT) or "prod").strip().lower()
    return value if value in _DEPLOYMENTS else "prod"


def status():
    """For the settings UI: whether it is on, and whether the environment
    decided that (in which case the toggle is not the operator's to flip)."""
    return {
        "enabled": is_enabled(),
        "forcedByEnvironment": env_override() is not None,
        "deployment": deployment(),
    }


def _identity_path():
    return os.path.join(folder_paths.get_user_directory(), "default", "mobile", "telemetry.json")


def _load_identity_locked():
    global _identity
    if _identity is not None:
        return _identity
    path = _identity_path()
    loaded = None
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
        except Exception:
            loaded = None
    if not (isinstance(loaded, dict) and _is_uuid4(loaded.get("install_id"))):
        now = time.time()
        loaded = {"install_id": str(uuid.uuid4()), "installed_at": now, "last_summary_at": now}
        atomic_write_json(path, loaded, prefix=".telemetry.")
    _identity = loaded
    return _identity


def _is_uuid4(value):
    try:
        return isinstance(value, str) and uuid.UUID(value).version == 4 and str(uuid.UUID(value)) == value
    except Exception:
        return False


def forget():
    """Telemetry is off: drop anything queued and delete the install id, so a
    later re-enable starts as a new install rather than resuming the old one."""
    global _identity
    with _lock:
        _queue.clear()
        _prompt_families.clear()
        _reset_hour()
        _identity = None
        try:
            os.remove(_identity_path())
        except FileNotFoundError:
            pass
        except Exception as exc:
            print(f"{_LOG_PREFIX} could not delete install id: {exc}", flush=True)


# -- recording ------------------------------------------------------------------

def _reset_hour(now=None):
    global _hour
    _hour = _new_hour(now)


def _tally(update):
    """Apply `update(hour)` to this hour's counts if telemetry is on. Never raises."""
    try:
        if not is_enabled():
            return
        with _lock:
            update(_hour)
    except Exception as exc:
        print(f"{_LOG_PREFIX} tally failed: {exc}", flush=True)


def note_frontend_open(surface):
    _tally(lambda hour: hour["opens"].update([surface]))


def note_prompt_queued(surface):
    _tally(lambda hour: hour["queued"].update([surface]))


def record(event, **properties):
    """Queue one event if telemetry is on. Never raises."""
    try:
        if not is_enabled():
            return
        kept = allowed_properties(event, properties)
        if kept is None:
            return
        kept["node_version"] = NODE_VERSION
        kept["measurement_version"] = MEASUREMENT_VERSION
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        with _lock:
            _load_identity_locked()
            _queue.append({"event": event, "timestamp": timestamp, "properties": kept})
    except Exception as exc:
        print(f"{_LOG_PREFIX} record failed: {exc}", flush=True)


def surface_from_user_agent(user_agent):
    ua = (user_agent or "").lower()
    if "cueforgeshareextension" in ua:
        return "share_extension"  # the Share Sheet's hidden page, queueing a shared image
    return "ios_app" if "cueforgeios" in ua else "web"


# ComfyUI's model-detection class name -> the contract's model_family. Ordered:
# the first matching prefix wins, so the specific (Flux2) precedes the general
# (Flux). Anything unmatched is "other"; a model's own name never leaves.
_FAMILY_PREFIXES = (
    ("SDXL", "sdxl"), ("SSD1B", "sdxl"), ("Segmind_Vega", "sdxl"), ("KOALA", "sdxl"),
    ("SD15", "sd15"), ("SD20", "sd2"), ("SD21", "sd2"), ("SD3", "sd3"),
    ("Stable_Cascade", "stable_cascade"),
    ("SVD", "stable_video"), ("SV3D", "stable_video"), ("Stable_Zero123", "stable_video"),
    ("Flux2", "flux2"), ("Flux", "flux"), ("Chroma", "chroma"), ("HiDream", "hidream"),
    ("QwenImage", "qwen_image"), ("ZImage", "z_image"), ("Lumina", "lumina"),
    ("AuraFlow", "auraflow"), ("PixArt", "pixart"),
    ("HunyuanDiT", "hunyuan_image"), ("HunyuanImage", "hunyuan_image"),
    ("HunyuanVideo", "hunyuan_video"), ("Hunyuan3D", "3d"), ("TripoSplat", "3d"), ("Trellis", "3d"),
    ("WAN", "wan"), ("LTX", "ltx"), ("GenmoMochi", "mochi"), ("Cosmos", "cosmos"),
    ("CogVideoX", "cogvideo"), ("Kandinsky", "kandinsky"),
    ("StableAudio", "audio"), ("ACEStep", "audio"), ("YuE", "audio"), ("MiniMaxMusic", "audio"),
)


def family_from_config_name(name):
    for prefix, family in _FAMILY_PREFIXES:
        if name.startswith(prefix):
            return family
    return "other"


def _record_loaded_model_family(models):
    """Remember a model requested by the executing node for its own prompt.

    The loader is called for both new and already-resident models. Text
    encoders and VAEs have no model_config and leave the prompt's family alone.
    Without an execution context, omit the family rather than guess a prompt.
    """
    try:
        if not is_enabled():
            return
        from comfy_execution.utils import get_executing_context
        context = get_executing_context()
        prompt_id = getattr(context, "prompt_id", None)
        if not isinstance(prompt_id, str) or not prompt_id:
            return
        for patcher in models:
            base = getattr(patcher, "model", None)
            config = getattr(base, "model_config", None)
            if config is not None:
                family = family_from_config_name(type(config).__name__)
                with _lock:
                    _prompt_families[prompt_id] = family
                    _prompt_families.move_to_end(prompt_id)
                    while len(_prompt_families) > MAX_QUEUE:
                        _prompt_families.popitem(last=False)
                return
    except Exception:
        pass


def install_model_family_tracking():
    """Observe requested models without changing ComfyUI's loader behaviour."""
    global _model_family_tracking_installed
    if _model_family_tracking_installed:
        return False
    try:
        import comfy.model_management as model_management
        original = model_management.load_models_gpu
    except Exception:
        return False

    @functools.wraps(original)
    def load_models_gpu(models, *args, **kwargs):
        result = original(models, *args, **kwargs)
        # Telemetry must never affect whether a model loads or its return value.
        try:
            _record_loaded_model_family(models)
        except Exception:
            pass
        return result

    model_management.load_models_gpu = load_models_gpu
    _model_family_tracking_installed = True
    return True


def record_prompt_finished(entry, *, prompt_id=None):
    """Count one finished run into this hour: its outcome, how long it ran, the
    architecture of the model that ran and, on error, the exception's type name -
    never its message."""
    status_block = entry.get("status") if isinstance(entry, dict) else None
    messages = status_block.get("messages") if isinstance(status_block, dict) else None
    started = ended = None
    outcome = None
    error_class = None
    for message in messages or []:
        if not (isinstance(message, (list, tuple)) and len(message) == 2):
            continue
        kind, data = message
        stamp = data.get("timestamp") if isinstance(data, dict) else None
        if kind == "execution_start":
            started = stamp
        elif kind in ("execution_success", "execution_error", "execution_interrupted"):
            ended = stamp
            outcome = {"execution_success": "success", "execution_error": "error",
                       "execution_interrupted": "interrupted"}[kind]
            if kind == "execution_error" and isinstance(data, dict):
                raw = str(data.get("exception_type") or "")
                error_class = raw.rsplit(".", 1)[-1] or None
    if outcome is None and isinstance(status_block, dict):
        outcome = {"success": "success", "error": "error"}.get(status_block.get("status_str"))
    duration = None
    if isinstance(started, (int, float)) and isinstance(ended, (int, float)) and ended >= started:
        duration = (ended - started) / 1000.0
    if prompt_id is None and isinstance(entry, dict):
        prompt = entry.get("prompt")
        if isinstance(prompt, (list, tuple)) and len(prompt) > 1:
            prompt_id = prompt[1]
    with _lock:
        family = _prompt_families.pop(prompt_id, None) if isinstance(prompt_id, str) else None

    def update(hour):
        if outcome:
            hour["outcomes"].update([outcome])
        if duration is not None:
            hour["durations"].append(duration)
        if family:
            hour["families"].update([family])
        if error_class and _type_name(error_class):
            hour["errors"].update([error_class])
    _tally(update)


def _count_media(entry):
    outputs = entry.get("outputs") if isinstance(entry, dict) else None
    count = 0
    for node_output in (outputs or {}).values() if isinstance(outputs, dict) else []:
        if isinstance(node_output, dict):
            for key in ("images", "gifs", "videos", "video", "audio"):
                if isinstance(node_output.get(key), list):
                    count += len(node_output[key])
    return count


def record_push_result(channel, result):
    """Count one finished run's notification, from a push module's
    {sent, pruned, failed, total} result. Nothing when nobody is paired."""
    if not isinstance(result, dict) or not result.get("total"):
        return
    delivered = "delivered" if result.get("sent") else "failed"
    _tally(lambda hour: hour["pushes"].update([delivered]))


# -- startup facts --------------------------------------------------------------

def _platform():
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "darwin"
    return "other"


def _install_source():
    here = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(here, ".tracking")):
        return "registry"  # comfy-cli / the Registry leave a .tracking manifest
    if os.path.isdir(os.path.join(here, ".git")):
        return "git"  # a git clone, by hand or by ComfyUI-Manager
    return "other"


def _comfyui_version():
    try:
        import comfyui_version  # ComfyUI's own version module
        value = str(getattr(comfyui_version, "__version__", ""))
        return value if _version(value) else "unknown"
    except Exception:
        return "unknown"


def _multiuser_installed():
    return any("multiuser" in name for name in list(sys.modules))


def record_started():
    record(
        "node started",
        platform=_platform(),
        python_version=".".join(str(p) for p in sys.version_info[:3]),
        comfyui_version=_comfyui_version(),
        install_source=_install_source(),
        multiuser=_multiuser_installed(),
    )


# -- sending --------------------------------------------------------------------

def _paired_app():
    try:
        import mobile_app_push
        return bool(mobile_app_push._load_targets())
    except Exception:
        return False


def _maybe_queue_hourly(now):
    """At the end of an hour with activity, its counts as one summary. An idle
    hour sends nothing."""
    with _lock:
        hour = _hour
        if now - hour["started"] < HOUR_SECONDS:
            return
        _reset_hour(now)
    active = (sum(hour["opens"].values()) or sum(hour["queued"].values())
              or sum(hour["outcomes"].values()) or sum(hour["pushes"].values())
              or hour["request_failures"])
    if not active:
        return
    properties = {}
    for surface in ("ios_app", "share_extension", "web"):
        properties[f"opens_{surface}_bucket"] = bucket_count(hour["opens"][surface])
        properties[f"queued_{surface}_bucket"] = bucket_count(hour["queued"][surface])
    properties["succeeded_bucket"] = bucket_count(hour["outcomes"]["success"])
    properties["failed_bucket"] = bucket_count(hour["outcomes"]["error"])
    properties["interrupted_bucket"] = bucket_count(hour["outcomes"]["interrupted"])
    if hour["durations"]:
        properties["median_duration_bucket"] = bucket_duration(statistics.median(hour["durations"]))
    if hour["families"]:
        properties["top_model_family"] = hour["families"].most_common(1)[0][0]
    if hour["errors"]:
        properties["top_error_class"] = hour["errors"].most_common(1)[0][0]
    properties["pushes_delivered_bucket"] = bucket_count(hour["pushes"]["delivered"])
    properties["pushes_failed_bucket"] = bucket_count(hour["pushes"]["failed"])
    properties["request_failures_bucket"] = bucket_count(hour["request_failures"])
    record("hourly summary", **properties)


def _maybe_queue_summary(now):
    """Once a day, active or not: the install is alive."""
    with _lock:
        identity = _load_identity_locked()
        if now - identity.get("last_summary_at", now) < SUMMARY_INTERVAL_SECONDS:
            return
        identity["last_summary_at"] = now
        atomic_write_json(_identity_path(), identity, prefix=".telemetry.")
        days = (now - identity.get("installed_at", now)) / 86400.0
    record(
        "daily summary",
        paired_app=_paired_app(),
        days_since_install_bucket=bucket_days(days),
    )


def take_batch():
    """Up to MAX_BATCH queued events as a relay batch body, or None."""
    with _lock:
        if not _queue:
            return None
        identity = _load_identity_locked()
        events = [_queue.popleft() for _ in range(min(MAX_BATCH, len(_queue)))]
        return {"install_id": identity["install_id"], "deployment": deployment(), "events": events}


def send(batch):
    """POST one batch to the relay. Blocking; run in an executor. A lost batch is
    an acceptable gap, so there is no retry and nothing is re-queued."""
    if not _REQUESTS_AVAILABLE or not batch:
        return False
    try:
        response = requests.post(RELAY_URL, json=batch, timeout=10)
        return response.status_code == 202
    except Exception:
        return False


def flush_once(now=None):
    """One tick of the flush loop, callable from a test. Blocking."""
    if not is_enabled():
        if _identity is not None or os.path.isfile(_identity_path()):
            forget()
        return None
    now = now if now is not None else time.time()
    _maybe_queue_hourly(now)
    _maybe_queue_summary(now)
    batch = take_batch()
    if batch:
        send(batch)
    return batch


async def _flush_loop():
    import asyncio
    loop = asyncio.get_event_loop()
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
        try:
            await loop.run_in_executor(None, flush_once)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let telemetry take the server down
            print(f"{_LOG_PREFIX} flush failed: {exc}", flush=True)


async def on_startup(app):
    import asyncio
    if app.get("mobile_telemetry_task") is not None:
        return
    install_model_family_tracking()
    record_started()
    app["mobile_telemetry_task"] = asyncio.create_task(_flush_loop())
    if is_enabled():
        print(f"{_LOG_PREFIX} anonymous operational telemetry is on "
              f"(what is sent: CUEFORGE_PRIVACY.md). Turn it off in Preferences "
              f"or with COMFYUI_MOBILE_TELEMETRY=0.", flush=True)
    else:
        print(f"{_LOG_PREFIX} telemetry off", flush=True)


async def on_cleanup(app):
    task = app.get("mobile_telemetry_task")
    if task is not None:
        task.cancel()


# -- request middleware ---------------------------------------------------------

def make_prompt_middleware(web):
    """Main-app middleware: count each accepted POST /prompt into this hour."""
    @web.middleware
    async def mobile_telemetry_prompt_middleware(request, handler):
        response = await handler(request)
        try:
            if (request.method == "POST" and request.path in ("/prompt", "/api/prompt")
                    and getattr(response, "status", 0) == 200 and is_enabled()):
                note_prompt_queued(surface_from_user_agent(request.headers.get("User-Agent")))
        except Exception:
            pass
        return response
    return mobile_telemetry_prompt_middleware


def make_error_middleware(web):
    """/mobile sub-app middleware: count each 5xx into this hour, whether the
    handler returned it, raised it as an HTTPException, or crashed. Only the
    count leaves the server, never the path, which can hold file and folder
    names."""
    @web.middleware
    async def mobile_telemetry_error_middleware(request, handler):
        try:
            response = await handler(request)
        except web.HTTPException as exc:
            if exc.status >= 500:
                _record_failure()
            raise
        except Exception:
            _record_failure()
            raise
        if getattr(response, "status", 0) >= 500:
            _record_failure()
        return response
    return mobile_telemetry_error_middleware


def _record_failure():
    def update(hour):
        hour["request_failures"] += 1
    _tally(update)
