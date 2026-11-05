import importlib
import sys
from types import ModuleType
from unittest.mock import MagicMock

# Stub out ComfyUI-specific modules (and optional runtime deps that the backend
# imports defensively) so the modules can be imported by pytest without the full
# ComfyUI runtime or those deps installed. 'requests' is optional in
# mobile_app_push (guarded by _REQUESTS_AVAILABLE); the push tests monkeypatch
# requests.post, so it must resolve to a stub on the minimal CI runner.
#
# pytest 9.2's monkeypatch reads the old value from the instance __dict__, where
# a MagicMock never keeps its auto-created attributes, so undo() deletes them —
# and a deleted mock attribute raises from then on. Deleting one from a stub
# returns it to auto-created instead.
class _Stub(MagicMock):
    def __delattr__(self, name):
        self._mock_children.pop(name, None)
        self.__dict__.pop(name, None)


for mod_name in ('server', 'aiohttp', 'aiohttp.web', 'folder_paths', 'requests'):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = _Stub()

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
