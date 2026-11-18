"""Attachment checks (M10-T2, unit): the type from the bytes, names made safe, files disguised as another type."""

import io
import zipfile

import pytest

from ucp import files

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32


def zipped(*names: str, size: int = 10) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            archive.writestr(name, b"\x00" * size)
    return buffer.getvalue()


DOCX = zipped("[Content_Types].xml", "word/document.xml")


@pytest.mark.parametrize(
    ("name", "data", "kind"),
    [
        ("Tenancy agreement.pdf", PDF, "application/pdf"),
        ("passport.PNG", PNG, "image/png"),
        ("photo.jpg", JPEG, "image/jpeg"),
        ("photo.jpeg", JPEG, "image/jpeg"),
        ("letter.doc", DOC, "application/msword"),
        ("essay.docx", DOCX, files.DOCX),
    ],
)
def test_each_type_pf_takes_is_accepted_by_its_bytes_and_name(name, data, kind):
    assert files.checked(name, data) == (name, kind)


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("invoice.pdf", b"MZ\x90\x00" + b"\x00" * 60),  # a Windows program renamed to .pdf
        ("photo.jpg", PNG),  # a picture, but not what its name says
        ("notes.docx", zipped("notes.txt")),  # a zip that is not a Word document
        ("notes.docx", b"PK\x03\x04 not really a zip"),
        ("page.html", b"<script>alert(1)</script>"),
        ("drawing.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
        ("sheet.xlsx", zipped("xl/workbook.xml")),
        ("empty.pdf", b""),
        ("no-extension", PDF),
    ],
)
def test_anything_else_and_files_disguised_as_another_type_are_refused(name, data):
    with pytest.raises(ValueError):
        files.checked(name, data)


def test_a_file_over_10_mb_is_refused_and_one_at_10_mb_is_not():
    assert files.checked("big.pdf", PDF + b"\x00" * (files.MAX_BYTES - len(PDF)))[1] == "application/pdf"
    with pytest.raises(ValueError):
        files.checked("big.pdf", PDF + b"\x00" * (files.MAX_BYTES - len(PDF) + 1))


def test_a_compressed_bomb_is_judged_by_its_directory_without_being_unpacked():
    bomb = zipped("word/document.xml", size=200 * 1024 * 1024)  # 200 MB inside, a few hundred kilobytes outside
    assert len(bomb) < files.MAX_BYTES
    assert files.checked("bomb.docx", bomb)[1] == files.DOCX  # accepted as Word only by its directory; nothing unpacked


@pytest.mark.parametrize(
    ("given", "shown"),
    [
        ("../../etc/passwd.pdf", "passwd.pdf"),
        ("C:\\Users\\me\\report.pdf", "report.pdf"),
        ("invoice\u202efdp.exe", "invoicefdp.exe"),  # the right-to-left override that makes exe.pdf look like a pdf
        ("tab\there\x00.pdf", "tabhere.pdf"),
        ("trailing.pdf. . ", "trailing.pdf"),
        ("...", "file"),
        ("Résumé – Zoë.docx", "Résumé – Zoë.docx"),
    ],
)
def test_hostile_names_are_made_plain(given, shown):
    assert files.clean_name(given) == shown


def test_a_long_name_keeps_its_extension():
    name = files.clean_name("a" * 400 + ".docx")
    assert len(name) == files.NAME_LIMIT and name.endswith(".docx")
