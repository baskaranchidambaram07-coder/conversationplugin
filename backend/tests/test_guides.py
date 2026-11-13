"""The guides customers follow say only what the tested files do (M15): every HTML and JavaScript snippet in the
College's guide is in a sample page the browser tests run (e2e/gateway/samples.spec.ts), and no guide links to a
file that is not there."""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLACES = ("*.md", "docs/*.md", "examples/**/*.md", "infra/**/*.md")
GUIDES = sorted(path for place in PLACES for path in ROOT.glob(place))


def flat(text: str) -> str:
    return "\n".join(line.strip() for line in text.strip().splitlines())


def test_every_snippet_in_the_college_guide_is_in_a_tested_sample():
    guide = (ROOT / "docs/college-sandbox-guide.md").read_text(encoding="utf-8")
    snippets = re.findall(r"```(?:html|js)\n(.*?)```", guide, re.DOTALL)
    samples = [flat(path.read_text(encoding="utf-8")) for path in (ROOT / "examples/college").glob("*.*")]
    assert len(snippets) >= 3
    for snippet in snippets:
        assert any(flat(snippet) in sample for sample in samples), snippet


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: str(path.relative_to(ROOT)))
def test_every_link_in_a_guide_reaches_a_file(guide):
    links = re.findall(r"\]\(([^)\s#]+)(?:#[^)]*)?\)", guide.read_text(encoding="utf-8"))
    missing = [link for link in links if "://" not in link and not (guide.parent / link).exists()]
    assert not missing
