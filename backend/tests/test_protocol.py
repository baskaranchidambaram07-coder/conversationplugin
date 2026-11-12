import json

import pytest
from pydantic import ValidationError

from ucp.protocol import ADAPTERS, KNOWN_BLOCK_TYPES, SCHEMA_FILE, json_schema, schema_text

# Shared with the TypeScript tests (protocol/src/examples.test.ts): the folder names the type and the verdict.
EXAMPLES = SCHEMA_FILE.parents[1] / "examples" / "v1"
FILES = sorted(EXAMPLES.glob("*/*/*.json"))


def test_schema_file_matches_the_models():
    assert SCHEMA_FILE.read_text(encoding="utf-8") == schema_text(), "Run: cd backend && uv run python -m ucp.protocol"


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.relative_to(EXAMPLES).as_posix())
def test_example_gets_the_verdict_its_folder_states(path):
    kind, verdict = path.parts[-3:-1]
    adapter, raw = ADAPTERS[kind], path.read_bytes()

    if verdict == "valid":
        value = adapter.validate_json(raw)
        # Nothing converted, added or dropped: Python reads exactly the value TypeScript reads.
        assert adapter.dump_python(value, mode="json", exclude_unset=True) == json.loads(raw)
    else:
        assert verdict == "invalid"
        with pytest.raises(ValidationError):
            adapter.validate_json(raw)


def test_every_type_has_valid_and_invalid_examples_and_every_block_and_event_has_a_valid_one():
    def valid_types(kind):
        return {json.loads(path.read_bytes())["type"] for path in EXAMPLES.glob(f"{kind}/valid/*.json")}

    for kind in ADAPTERS:
        assert list(EXAMPLES.glob(f"{kind}/valid/*.json")) and list(EXAMPLES.glob(f"{kind}/invalid/*.json")), kind
    assert valid_types("StreamEvent") == set(json_schema()["$defs"]["StreamEvent"]["discriminator"]["mapping"])
    assert set(KNOWN_BLOCK_TYPES) < valid_types("Block"), "each block type, plus at least one unknown type"
