import json
from pathlib import Path

import pytest

from mobile_metadata import (
    MetadataPathError,
    extract_workflow_from_metadata,
    resolve_metadata_path,
)


def test_resolve_metadata_path_uses_video_sidecar_image(tmp_path: Path):
    output_dir = tmp_path / "output"
    input_dir = tmp_path / "input"
    output_dir.mkdir()
    input_dir.mkdir()
    video = output_dir / "clip.mp4"
    sidecar = output_dir / "clip.png"
    video.write_bytes(b"video")
    sidecar.write_bytes(b"image")

    resolved = resolve_metadata_path("clip.mp4", "output", str(input_dir), str(output_dir))
    assert resolved == str(sidecar)


def test_resolve_metadata_path_rejects_path_traversal(tmp_path: Path):
    output_dir = tmp_path / "output"
    input_dir = tmp_path / "input"
    output_dir.mkdir()
    input_dir.mkdir()
    outside_file = tmp_path / "outside.png"
    outside_file.write_bytes(b"x")

    with pytest.raises(MetadataPathError) as exc:
        resolve_metadata_path("../outside.png", "output", str(input_dir), str(output_dir))
    assert exc.value.status_code == 403


def test_resolve_metadata_path_errors_when_video_has_no_sidecar(tmp_path: Path):
    output_dir = tmp_path / "output"
    input_dir = tmp_path / "input"
    output_dir.mkdir()
    input_dir.mkdir()
    (output_dir / "clip.mp4").write_bytes(b"video")

    with pytest.raises(MetadataPathError) as exc:
        resolve_metadata_path("clip.mp4", "output", str(input_dir), str(output_dir))
    assert exc.value.status_code == 404
    assert str(exc.value) == "No image metadata found for video"


def test_extract_workflow_from_metadata_prefers_workflow_field():
    metadata = {
        "workflow": json.dumps({"id": "workflow-from-field"}),
        "prompt": json.dumps(
            {
                "extra_pnginfo": {
                    "workflow": {"id": "workflow-from-prompt"},
                }
            }
        ),
    }

    workflow = extract_workflow_from_metadata(metadata)
    assert workflow == {"id": "workflow-from-field"}


def test_extract_workflow_from_metadata_reads_prompt_fallback():
    metadata = {
        "prompt": json.dumps(
            {
                "extra_pnginfo": {
                    "workflow": {"id": "workflow-from-prompt"},
                }
            }
        )
    }

    workflow = extract_workflow_from_metadata(metadata)
    assert workflow == {"id": "workflow-from-prompt"}


def test_prompt_text_cache_eviction_is_thread_safe(tmp_path: Path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    import mobile_metadata as metadata

    metadata.clear_prompt_text_cache()
    monkeypatch.setattr(metadata, "_PROMPT_TEXT_CACHE_MAX", 10)
    monkeypatch.setattr(
        metadata,
        "_read_prompt_text",
        lambda path: Path(path).stem,
    )
    paths = []
    for index in range(40):
        path = tmp_path / f"{index}.png"
        path.write_bytes(b"metadata")
        paths.append(str(path))

    with ThreadPoolExecutor(max_workers=8) as executor:
        values = list(executor.map(metadata.get_cached_prompt_text, paths * 3))

    assert all(value for value in values)
    assert len(metadata._PROMPT_TEXT_CACHE) <= metadata._PROMPT_TEXT_CACHE_MAX
