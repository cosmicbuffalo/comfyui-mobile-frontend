import json
import os
from typing import Any

IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
VIDEO_EXTENSIONS = ('.mp4', '.mov', '.webm', '.mkv')


class MetadataPathError(ValueError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def resolve_metadata_path(
    filepath: str,
    source: str,
    input_dir: str,
    output_dir: str,
) -> str:
    if not filepath:
        raise MetadataPathError("No path provided", 400)

    base_dir = input_dir if source == 'input' else output_dir
    base_dir_abs = os.path.abspath(base_dir)
    target_path = os.path.abspath(os.path.join(base_dir_abs, filepath))

    if not target_path.startswith(base_dir_abs):
        raise MetadataPathError("Access denied", 403)

    if not os.path.exists(target_path):
        raise MetadataPathError("File not found", 404)

    if os.path.isdir(target_path):
        raise MetadataPathError("Folder metadata not supported", 400)

    ext = os.path.splitext(target_path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        base_name = os.path.splitext(os.path.basename(target_path))[0]
        folder_path = os.path.dirname(target_path)
        for image_ext in IMAGE_EXTENSIONS:
            candidate = os.path.join(folder_path, base_name + image_ext)
            if os.path.exists(candidate):
                return candidate
        raise MetadataPathError("No image metadata found for video", 404)

    if ext not in IMAGE_EXTENSIONS:
        raise MetadataPathError("Unsupported file type", 400)

    return target_path


def extract_workflow_from_metadata(metadata: dict[str, Any]) -> Any | None:
    workflow_value = metadata.get('workflow') or metadata.get('Workflow')
    if isinstance(workflow_value, bytes):
        workflow_value = workflow_value.decode('utf-8', errors='ignore')
    if workflow_value:
        try:
            return json.loads(workflow_value) if isinstance(workflow_value, str) else workflow_value
        except Exception:
            pass

    prompt_value = metadata.get('prompt') or metadata.get('Prompt')
    if isinstance(prompt_value, bytes):
        prompt_value = prompt_value.decode('utf-8', errors='ignore')
    if not prompt_value:
        return None

    try:
        prompt_data = json.loads(prompt_value)
    except Exception:
        return None

    extra_pnginfo = prompt_data.get('extra_pnginfo', {})
    if isinstance(extra_pnginfo, str):
        try:
            extra_pnginfo = json.loads(extra_pnginfo)
        except Exception:
            extra_pnginfo = {}
    return (
        extra_pnginfo.get('workflow')
        or prompt_data.get('workflow')
        or prompt_data.get('workflow_v2')
    )
