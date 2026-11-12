import pytest
from pydantic import ValidationError

from ucp.protocol import ADAPTERS, SCHEMA_FILE, schema_text


def test_schema_file_matches_the_models():
    assert SCHEMA_FILE.read_text(encoding="utf-8") == schema_text(), "Run: cd backend && uv run python -m ucp.protocol"


def test_an_unknown_block_type_falls_back_but_a_known_type_stays_strict():
    block = ADAPTERS["Block"]

    assert block.validate_json('{"type": "chart", "text": "Sales rose", "series": []}').type == "chart"
    with pytest.raises(ValidationError):
        block.validate_json('{"type": "markdown"}')
