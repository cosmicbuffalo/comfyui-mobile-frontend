import importlib
import sys
from types import ModuleType
from unittest.mock import MagicMock

# Stub out ComfyUI-specific modules (and optional runtime deps that the backend
# imports defensively) so the modules can be imported by pytest without the full
# ComfyUI runtime or those deps installed. 'requests' is optional in
# mobile_app_push (guarded by _REQUESTS_AVAILABLE); the push tests monkeypatch
# requests.post, so it must resolve to a stub on the minimal CI runner.
for mod_name in ('server', 'aiohttp', 'aiohttp.web', 'folder_paths', 'requests'):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

# PIL is a real dependency for the dimension reader, which parses actual image
# headers, so prefer the installed Pillow and stub only when it is missing.
# Stubbing unconditionally and having that one module delete the stubs at import
# time leaked across the session — whichever module happened to be collected
# after it saw a different PIL than the one it was written against.
for mod_name in ('PIL', 'PIL.Image', 'PIL.ImageOps'):
    if mod_name in sys.modules:
        continue
    try:
        importlib.import_module(mod_name)
    except Exception:
        sys.modules[mod_name] = MagicMock()

collect_ignore_glob = ['__init__.py']
