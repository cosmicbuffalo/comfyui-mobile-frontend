import sys
from types import ModuleType
from unittest.mock import MagicMock

# Stub out ComfyUI-specific modules (and optional runtime deps that the backend
# imports defensively) so the modules can be imported by pytest without the full
# ComfyUI runtime or those deps installed. 'requests' is optional in
# mobile_app_push (guarded by _REQUESTS_AVAILABLE); the push tests monkeypatch
# requests.post, so it must resolve to a stub on the minimal CI runner.
for mod_name in ('server', 'aiohttp', 'aiohttp.web', 'folder_paths', 'PIL',
                 'PIL.Image', 'PIL.ImageOps', 'requests'):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

collect_ignore_glob = ['__init__.py']
