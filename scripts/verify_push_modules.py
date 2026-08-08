"""Standalone verification of the push backend logic (no ComfyUI / network).

Exercises mobile_app_push, mobile_push_prefs, and mobile_push helpers by stubbing
`folder_paths` (temp dir) and `server`, and faking requests.post. Run with the
ComfyUI python env:

    python scripts/verify_push_modules.py

Not named test_* on purpose: it mutates sys.modules globally, so it shouldn't be
auto-collected into the pytest suite.
"""
import os
import sys
import tempfile
import types

EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_tmp = tempfile.mkdtemp()

# Stub ComfyUI-provided modules the push code imports.
_fp = types.ModuleType("folder_paths")
_fp.get_user_directory = lambda: _tmp
sys.modules["folder_paths"] = _fp
sys.modules["server"] = types.ModuleType("server")

sys.path.insert(0, EXT_DIR)

import mobile_app_push  # noqa: E402
import mobile_push_prefs  # noqa: E402
import mobile_push  # noqa: E402

_passed = 0


def check(label, cond):
    global _passed
    assert cond, f"FAIL: {label}"
    _passed += 1
    print(f"  ok: {label}")


# --- mobile_app_push: target validation + storage ---
print("mobile_app_push targets:")
check("https target accepted", mobile_app_push.add_target("https://relay.example", "AAAA-BBBB", "Phone"))
check("http target rejected", not mobile_app_push.add_target("http://nope", "CCCC-DDDD"))
check("empty code rejected", not mobile_app_push.add_target("https://relay.example", ""))
check("count is 1", mobile_app_push.target_count() == 1)
targets = mobile_app_push.list_targets()
check("code masked to last 4", targets[0]["code_hint"] == "BBBB")
check("full code not exposed in list", "pairing_code" not in targets[0])

# --- mobile_app_push: send posts to relay /event with the right body ---
print("mobile_app_push send:")
_calls = []


class _Resp:
    def __init__(self, code):
        self.status_code = code
        self.text = ""

    def json(self):
        return {}


def _post_ok(url, json=None, timeout=None):
    _calls.append((url, json))
    return _Resp(200)


mobile_app_push.requests.post = _post_ok
res = mobile_app_push.send_completion("pid-1", "success", 2, image_url="/mobile/api/thumbnail?x", click_url="/mobile/")
check("one send", res["sent"] == 1 and res["pruned"] == 0)
url, body = _calls[-1]
check("posts to relay /event", url == "https://relay.example/event")
check("body carries pairing_code", body["pairing_code"] == "AAAA-BBBB")
check("body carries prompt_id/status", body["prompt_id"] == "pid-1" and body["status"] == "success")
check("body carries image + url", body["image"] == "/mobile/api/thumbnail?x" and body["url"] == "/mobile/")

# --- mobile_app_push: dead target (404) gets pruned ---
print("mobile_app_push prune:")
mobile_app_push.requests.post = lambda url, json=None, timeout=None: _Resp(404)
res = mobile_app_push.send_completion("pid-2", "success", 0)
check("pruned the gone target", res["pruned"] == 1)
check("count back to 0", mobile_app_push.target_count() == 0)

# --- mobile_push_prefs: defaults + merge ---
print("mobile_push_prefs:")
prefs = mobile_push_prefs.get_prefs()
check("defaults notifyOnComplete", prefs["notifyOnComplete"] is True)
check("defaults includeThumbnail off", prefs["includeThumbnail"] is False)
saved = mobile_push_prefs.set_prefs({"includeThumbnail": True, "notifyOnComplete": False, "bogus": 1})
check("set includeThumbnail", saved["includeThumbnail"] is True)
check("set notifyOnComplete", saved["notifyOnComplete"] is False)
check("ignores unknown keys", "bogus" not in saved)

# --- mobile_push: thumbnail extraction from a history entry ---
print("mobile_push thumbnail extraction:")
entry = {"outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "sub", "type": "output"}]}}}
img = mobile_push.find_first_output_image(entry)
check(
    "resolves the first output image",
    img == {"filename": "a.png", "subfolder": "sub", "source": "output"},
)
check("none when no images", mobile_push.find_first_output_image({"outputs": {}}) is None)
# The notification URL is keyed by prompt_id on purpose: the payload transits
# the relay and APNs, so it must never carry a filename (see CUEFORGE_PRIVACY.md).
check(
    "notification url carries only the prompt id",
    mobile_push._completion_image_url("abc-123", entry)
    == "/mobile/api/thumbnail?prompt_id=abc-123",
)
check("no url when there is no image", mobile_push._completion_image_url("abc-123", {}) is None)

print(f"\nALL {_passed} CHECKS PASSED")
