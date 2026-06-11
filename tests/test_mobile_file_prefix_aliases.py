import json
from pathlib import Path

from mobile_file_prefix_aliases import (
    ALIAS_PREFIX,
    ensure_aliases,
    migrate_legacy_cache,
    resolve_aliases,
)


def test_creates_stable_prefix_alias_and_resolves_it(tmp_path: Path):
    cache = tmp_path / "prefixes.json"
    raw = "private/client/%date:yyyy-MM-dd%/portrait"

    first = ensure_aliases(str(cache), [raw])[raw]
    second = ensure_aliases(str(cache), [raw])[raw]

    assert first == second
    assert first.startswith(ALIAS_PREFIX)
    assert resolve_aliases(str(cache), [first]) == {first: raw}


def test_unknown_alias_is_not_resolved(tmp_path: Path):
    cache = tmp_path / "prefixes.json"
    assert resolve_aliases(str(cache), [f"{ALIAS_PREFIX}unknown"]) == {}


def test_migrate_legacy_cache_seeds_durable_path_once(tmp_path: Path):
    legacy = tmp_path / ".cache" / "file_prefix_aliases_cache.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps(
        {"version": 1, "updatedAt": 1, "aliases": {f"{ALIAS_PREFIX}abc": "private/client"}}
    ))
    dest = tmp_path / "userdata" / "default" / "mobile" / "file_prefix_aliases.json"

    # Migrates from the first existing legacy path, preserving the mapping that
    # would otherwise be lost when .cache/ is wiped on a node update.
    assert migrate_legacy_cache(str(dest), [str(tmp_path / "missing.json"), str(legacy)]) is True
    assert json.loads(dest.read_text())["aliases"] == {f"{ALIAS_PREFIX}abc": "private/client"}
    # Idempotent: never overwrites an existing destination.
    assert migrate_legacy_cache(str(dest), [str(legacy)]) is False
