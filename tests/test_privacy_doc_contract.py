"""CUEFORGE_PRIVACY.md must describe exactly what mobile_telemetry sends.

The doc's telemetry table is written in a fixed shape - every field as
`field`: followed by its allowed values - so this test can read it and compare
it with `mobile_telemetry._CONTRACT`, the list that decides what may leave the
server. Add an event, a field or an allowed value to the contract and not to the
doc, or the other way round, and this fails: the privacy doc cannot drift from
the code.
"""
import os
import re

import mobile_app_prefs
import mobile_telemetry as telemetry

DOC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CUEFORGE_PRIVACY.md")
MARKER = "<!-- telemetry-contract:"
FIELD_GROUP = re.compile(r"((?:`[a-z0-9_]+`(?:,\s*)?)+):")
TOKEN = re.compile(r"`([^`]+)`")


def _doc():
    with open(DOC, encoding="utf-8") as f:
        return f.read()


def _telemetry_section():
    doc = _doc()
    start = doc.index("## Operational telemetry")
    end = doc.index("\n## ", start + 1)
    return doc[start:end]


def _table():
    """{event: {field: {documented values}}} from the table after the marker."""
    section = _telemetry_section()
    assert MARKER in section, "the telemetry table lost its contract marker"
    rows = [line for line in section[section.index(MARKER):].splitlines() if line.startswith("| `")]
    table = {}
    for row in rows:
        cells = [cell.strip() for cell in row.strip("|").split("|")]
        event = TOKEN.search(cells[0]).group(1)
        fields = {}
        groups = list(FIELD_GROUP.finditer(cells[1]))
        for index, group in enumerate(groups):
            names = TOKEN.findall(group.group(1))
            end = groups[index + 1].start() if index + 1 < len(groups) else len(cells[1])
            values = set(TOKEN.findall(cells[1][group.end():end]))
            for name in names:
                fields[name] = values
        table[event] = fields
    return table


def test_the_table_is_readable():
    table = _table()
    assert len(table) == len(telemetry._CONTRACT), "parsed a different number of events; the table's shape changed"
    assert all(table.values()), "an event row has no `field`: entries"


def test_every_event_sent_is_documented_and_nothing_else_is():
    documented = set(_table())
    sent = set(telemetry._CONTRACT)
    assert sent - documented == set(), (
        f"Sent but missing from CUEFORGE_PRIVACY.md: {sorted(sent - documented)}")
    assert documented - sent == set(), (
        f"Documented but no longer sent: {sorted(documented - sent)}")


def test_every_field_of_every_event_matches():
    table = _table()
    problems = []
    for event, rules in telemetry._CONTRACT.items():
        documented = set(table.get(event, {}))
        for field in sorted(set(rules) - documented):
            problems.append(f"{event}: `{field}` is sent but not documented")
        for field in sorted(documented - set(rules)):
            problems.append(f"{event}: `{field}` is documented but not sent")
    assert problems == [], "\n".join(problems)


def test_fixed_values_are_listed_exactly():
    """A field restricted to named values must list those values, all of them
    and only them. Ranges are described in words and exempt."""
    table = _table()
    problems = []
    for event, rules in telemetry._CONTRACT.items():
        for field, rule in rules.items():
            allowed = getattr(rule, "values", None)
            if allowed is None or getattr(rule, "is_bucket", False):
                continue
            documented = table.get(event, {}).get(field, set())
            if set(allowed) != documented:
                problems.append(
                    f"{event}: `{field}` sends {sorted(allowed)} but the doc lists {sorted(documented)}")
    assert problems == [], "\n".join(problems)


def test_the_envelope_and_common_fields_are_documented():
    section = _telemetry_section()
    for name in ("install_id", "deployment", *telemetry._COMMON):
        assert f"`{name}`" in section, f"`{name}` is sent with every batch or event but not documented"
    for value in telemetry._DEPLOYMENTS:
        assert f"`{value}`" in section, f"deployment `{value}` is not documented"
    for env in (telemetry.ENV_ENABLE, telemetry.ENV_DEPLOYMENT):
        assert env in section, f"{env} controls telemetry but is not documented"


def test_the_documented_default_is_the_real_default():
    on_by_default = mobile_app_prefs._DEFAULTS[telemetry.PREF_KEY] is True
    section = " ".join(_telemetry_section().lower().split())  # markdown wraps lines
    assert ("on by default" in section) == on_by_default
    assert ("off by default" in section) == (not on_by_default)


def _civitai_section():
    doc = _doc()
    start = doc.index("## CivitAI model metadata")
    end = doc.index("\n## ", start + 1)
    return " ".join(doc[start:end].lower().split())


def test_the_civitai_switch_is_documented_as_it_is():
    import model_metadata

    section = _civitai_section()
    assert model_metadata.ENV_ENABLE.lower() in section
    on_by_default = mobile_app_prefs._DEFAULTS[model_metadata.PREF_KEY] is True
    assert ("on by default" in section) == on_by_default
    assert ("off by default" in section) == (not on_by_default)
    assert "no switch to turn this off" not in section
