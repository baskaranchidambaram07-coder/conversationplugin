"""The malware scan (M10-T3): ClamAV's verdict on every attachment, and no file kept without one.

The real ClamAV runs in CI as a service container (UCP_TEST_CLAMD=host:port); elsewhere its tests skip and the
stand-in (fakescan.py) speaks the same protocol.
"""

import os

import pytest

from fakescan import infected_word_document
from tests.test_files import DOCX, PDF
from ucp.scan import ScanUnavailable, scan

pytestmark = pytest.mark.anyio
REAL = os.environ.get("UCP_TEST_CLAMD")


async def test_a_clean_file_passes_and_the_test_virus_inside_a_word_document_is_found(fake_scanner):
    assert await scan(fake_scanner, PDF) is None
    assert await scan(fake_scanner, DOCX) is None
    assert await scan(fake_scanner, infected_word_document()) == "Eicar-Test-Signature"


async def test_a_large_file_is_streamed_in_pieces(fake_scanner):
    assert await scan(fake_scanner, PDF + b"\x00" * (10 * 1024 * 1024)) is None


async def test_no_verdict_without_a_scanner_or_from_one_that_does_not_answer():
    with pytest.raises(ScanUnavailable):
        await scan(None, PDF)
    with pytest.raises(ScanUnavailable):
        await scan("127.0.0.1:9", PDF)  # nothing listens there


@pytest.mark.skipif(not REAL, reason="set UCP_TEST_CLAMD=host:port to scan with a real ClamAV")
async def test_the_real_clamav_passes_clean_files_and_finds_the_test_virus_hidden_in_a_word_document():
    assert await scan(REAL, PDF) is None
    assert await scan(REAL, DOCX) is None
    assert "Eicar" in await scan(REAL, infected_word_document())
