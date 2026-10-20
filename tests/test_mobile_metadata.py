import json
import struct
from pathlib import Path

import pytest

from mobile_metadata import (
    MetadataPathError,
    extract_prompt_from_metadata,
    extract_workflow_from_metadata,
    read_glb_metadata,
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


def test_extract_prompt_from_metadata_parses_executed_graph():
    prompt = {
        "7": {
            "class_type": "Seed (rgthree)",
            "inputs": {"seed": 123456},
        }
    }
    assert extract_prompt_from_metadata({"prompt": json.dumps(prompt)}) == prompt


def test_extract_prompt_from_metadata_accepts_an_existing_dict():
    prompt = {"7": {"inputs": {"seed": 123456}}}
    assert extract_prompt_from_metadata({"prompt": prompt}) is prompt


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


def _write_glb(path: Path, asset: dict) -> None:
    chunk = json.dumps({"asset": asset}).encode()
    chunk += b" " * (-len(chunk) % 4)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(chunk)) + struct.pack("<II", len(chunk), 0x4E4F534A) + chunk)


def test_glb_metadata_loads_the_workflow_core_save_glb_embeds(tmp_path: Path):
    output_dir = tmp_path / "output"
    input_dir = tmp_path / "input"
    output_dir.mkdir()
    input_dir.mkdir()
    workflow = {"id": "mesh-workflow", "nodes": []}
    # Core SaveGLB stores each hidden value as a JSON string under asset.extras.
    _write_glb(output_dir / "mesh.glb", {"version": "2.0", "extras": {
        "prompt": json.dumps({"1": {"class_type": "SaveGLB", "inputs": {}}}),
        "workflow": json.dumps(workflow),
    }})

    resolved = resolve_metadata_path("mesh.glb", "output", str(input_dir), str(output_dir))
    metadata = read_glb_metadata(resolved)
    assert extract_workflow_from_metadata(metadata) == workflow
    assert extract_prompt_from_metadata(metadata) == {"1": {"class_type": "SaveGLB", "inputs": {}}}


def test_glb_without_extras_has_no_workflow(tmp_path: Path):
    path = tmp_path / "plain.glb"
    _write_glb(path, {"version": "2.0"})
    assert extract_workflow_from_metadata(read_glb_metadata(str(path))) is None
    (tmp_path / "not-a-glb.glb").write_bytes(b"ply\nformat ascii 1.0\n")
    assert read_glb_metadata(str(tmp_path / "not-a-glb.glb")) == {}


def test_other_3d_formats_are_not_metadata_sources(tmp_path: Path):
    output_dir = tmp_path / "output"
    output_dir.mkdir()
    (output_dir / "cloud.ply").write_bytes(b"ply")
    with pytest.raises(MetadataPathError) as exc:
        resolve_metadata_path("cloud.ply", "output", str(tmp_path), str(output_dir))
    assert exc.value.status_code == 400


@pytest.mark.parametrize('asset', [None, [], 'invalid', 42])
def test_glb_non_object_asset_has_no_metadata(tmp_path: Path, asset):
    path = tmp_path / 'invalid-asset.glb'
    _write_glb(path, asset)
    assert read_glb_metadata(str(path)) == {}


@pytest.mark.parametrize('chunk', [b'{bad', b'\xff\xff\xff\xff', b'null', b'[]  '])
def test_glb_invalid_json_has_no_metadata(tmp_path: Path, chunk):
    path = tmp_path / 'invalid-json.glb'
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 20 + len(chunk), len(chunk), 0x4E4F534A) + chunk)
    assert read_glb_metadata(str(path)) == {}


def test_glb_oversized_json_is_rejected_without_reading_payload(tmp_path: Path, monkeypatch):
    from unittest.mock import call, mock_open
    import mobile_metadata

    length = mobile_metadata.MAX_GLB_JSON_BYTES + 4
    header = struct.pack('<4sIIII', b'glTF', 2, 20 + length, length, 0x4E4F534A)
    path = tmp_path / 'oversized.glb'
    path.write_bytes(header)
    with path.open('rb') as actual:
        reader = mock_open(read_data=header)
        reader.return_value.fileno.return_value = actual.fileno()
        monkeypatch.setattr(mobile_metadata, 'open', reader, raising=False)
        assert read_glb_metadata(str(path)) == {}
        assert reader.return_value.read.call_args_list == [call(20)]


@pytest.mark.parametrize('version, total, declared', [(1, 24, 4), (2, 24, 8), (2, 40, 4), (2, 24, 3)])
def test_glb_invalid_chunk_boundaries_have_no_metadata(tmp_path: Path, version, total, declared):
    path = tmp_path / 'invalid-length.glb'
    path.write_bytes(struct.pack('<4sIIII', b'glTF', version, total, declared, 0x4E4F534A) + b'{}  ')
    assert read_glb_metadata(str(path)) == {}
