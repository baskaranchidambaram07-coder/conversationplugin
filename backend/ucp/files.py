"""Attachments (M10-T2): what a visitor may send with a question. PF takes doc, docx, pdf, jpg, jpeg and png only.

A file's type is read from its own bytes and must agree with its name, so a program renamed to .pdf is refused.
shortcut: no malware scan yet, and files are kept in PostgreSQL; move them to S3 behind GuardDuty Malware Protection
(M10-T1, T3) before production.
"""

import io
import unicodedata
import zipfile

MAX_BYTES = 10 * 1024 * 1024
PER_QUESTION = 5
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TYPES = {  # by extension: the only types PF accepts
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "doc": "application/msword",
    "docx": DOCX,
}
NAME_LIMIT = 200


def kind_of(data: bytes) -> str | None:
    """The type the bytes are, by the format's own opening bytes, or None for anything PF does not take."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    # shortcut: any compound file (xls and ppt too) passes as Word 97; read its stream names if that matters
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "application/msword"
    if data.startswith(b"PK\x03\x04") and _is_docx(data):
        return DOCX
    return None


def _is_docx(data: bytes) -> bool:
    """A Word document is a zip holding word/document.xml. Only the zip's directory is read, nothing is unpacked, so
    a compressed bomb costs nothing here."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return "word/document.xml" in archive.namelist()
    except (zipfile.BadZipFile, ValueError, OSError):
        return False


def clean_name(name: str) -> str:
    """The name as shown and offered on download: no folders, no control or direction-changing characters, no
    trailing dots, at most 200 characters with the extension kept."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(char for char in base if unicodedata.category(char)[0] != "C").strip(" .")
    stem, dot, extension = base.rpartition(".")
    if len(base) > NAME_LIMIT:
        keep = dot and len(extension) <= 10
        base = f"{stem[: NAME_LIMIT - len(extension) - 1]}.{extension}" if keep else base[:NAME_LIMIT]
    return base or "file"


def checked(name: str, data: bytes) -> tuple[str, str]:
    """The cleaned name and the type of an acceptable file. ValueError when it is empty, too big, not a type PF takes,
    or not what its name says."""
    clean = clean_name(name)
    extension = clean.rpartition(".")[2].lower() if "." in clean else ""
    kind = kind_of(data)
    if not data or len(data) > MAX_BYTES or kind is None or TYPES.get(extension) != kind:
        raise ValueError("not an acceptable file")
    return clean, kind
