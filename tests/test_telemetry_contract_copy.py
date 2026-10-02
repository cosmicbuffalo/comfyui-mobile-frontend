"""telemetry_contract.json must be an exact copy of cueforge-telemetry's
contract.json - the file the CueForge relay validates against.

If they differ, the node either queues fields the relay drops (wasted, and a
privacy doc that over-promises) or the relay accepts fields the node never
sends. Compared against a checkout of cueforge-telemetry beside this repo.
Locally it is skipped without one; CI checks one out (test_backend.yml) and
fails rather than skips if it is missing, so drift can't pass unnoticed.
"""
import json
import os

import pytest

import mobile_telemetry as telemetry

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _source_path():
    sibling = os.path.join(os.path.dirname(REPO), "cueforge-telemetry", "contract.json")
    return sibling if os.path.isfile(sibling) else None


def test_the_vendored_contract_matches_the_relays():
    source = _source_path()
    if source is None:
        if os.environ.get("CI"):
            pytest.fail("CI must check out cueforge-telemetry beside this repo")
        pytest.skip("no cueforge-telemetry checkout beside this repo")
    with open(source, encoding="utf-8") as f:
        relay = json.load(f)
    assert telemetry.CONTRACT_SPEC == relay, (
        "telemetry_contract.json differs from cueforge-telemetry's contract.json. "
        f"Copy {source} over it (and update CUEFORGE_PRIVACY.md to match).")


def test_the_vendored_contract_loads_into_working_rules():
    # Whatever the copy says, every rule must turn into a validator.
    assert telemetry._CONTRACT
    for fields in telemetry._CONTRACT.values():
        assert all(callable(check) for check in fields.values())
