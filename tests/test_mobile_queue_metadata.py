from pathlib import Path

from mobile_queue_metadata import (
    get_prompt_metadata,
    remap_prompt_metadata,
    upsert_prompt_metadata,
)


def test_upsert_and_get_prompt_metadata(tmp_path: Path):
    cache_path = tmp_path / "queue_metadata.json"

    upsert_prompt_metadata(str(cache_path), "prompt-a", {
        "workflowLabel": "  My Workflow  ",
        "workflowSource": {"type": "user", "filename": "wf.json", "ignored": 123},
        "sessionId": "session-a",
        "workflowDiff": {"prompts": [], "nodeChanges": []},
    })

    metadata = get_prompt_metadata(str(cache_path), ["prompt-a", "missing"])
    assert metadata["prompt-a"]["workflowLabel"] == "My Workflow"
    assert metadata["prompt-a"]["workflowSource"] == {
        "type": "user",
        "filename": "wf.json",
    }
    assert metadata["prompt-a"]["sessionId"] == "session-a"
    assert metadata["prompt-a"]["workflowDiff"] == {"prompts": [], "nodeChanges": []}


def test_remap_prompt_metadata_moves_entry(tmp_path: Path):
    cache_path = tmp_path / "queue_metadata.json"
    upsert_prompt_metadata(str(cache_path), "old-prompt", {
        "workflowLabel": "Workflow",
    })

    remapped = remap_prompt_metadata(str(cache_path), "old-prompt", "new-prompt")

    metadata = get_prompt_metadata(str(cache_path))
    assert "old-prompt" not in metadata
    assert metadata["new-prompt"]["workflowLabel"] == "Workflow"
    assert remapped is not None
    assert remapped["promptId"] == "new-prompt"
