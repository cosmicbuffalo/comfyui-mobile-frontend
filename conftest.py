import sys
from types import ModuleType
from unittest.mock import MagicMock

# Stub out ComfyUI-specific modules so that __init__.py can be imported
# by pytest without the full ComfyUI runtime.
for mod_name in ('server', 'aiohttp', 'aiohttp.web', 'folder_paths', 'PIL',
                 'PIL.Image', 'PIL.ImageOps'):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

collect_ignore_glob = ['__init__.py']
