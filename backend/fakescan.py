"""A stand-in for ClamAV's clamd, for development and the gateway's tests: it speaks clamd's INSTREAM command and finds
the EICAR test file (anti-virus software's harmless agreed test signature), stored uncompressed anywhere in what it is
sent, and nothing else. The real ClamAV runs beside the gateway on AWS and as a service container in CI.

The EICAR string is kept in base64 so no file in this repository holds it: anti-virus software on a developer's
machine would quarantine the file.
"""

import asyncio
import base64
import io
import struct
import threading
import zipfile

EICAR = base64.b64decode("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=")


PACKAGE = "http://schemas.openxmlformats.org/package/2006"
WORD_PARTS = {
    "[Content_Types].xml": f'<Types xmlns="{PACKAGE}/content-types"><Default Extension="rels" '
    'ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" '
    'ContentType="application/xml"/><Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": f'<Relationships xmlns="{PACKAGE}/relationships"><Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>',
}


def word_document(text: str, extra: dict[str, bytes] | None = None) -> bytes:
    """A one-paragraph Word document holding `text`, made by hand so tests need no library. `extra` adds parts,
    stored uncompressed."""
    body = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    body += f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:  # stored, so this stand-in sees an extra part's bytes too
        for name, part in {**WORD_PARTS, "word/document.xml": body, **(extra or {})}.items():
            archive.writestr(name, part)
    return buffer.getvalue()


def infected_word_document() -> bytes:
    """A Word document carrying the EICAR file inside it: it passes the type checks (ucp.files), and ClamAV finds the
    test signature when it unpacks it, as it would a real virus hidden in an Office file."""
    return word_document("A harmless test of the virus scan.", {"word/media/eicar.com": EICAR})


async def _answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        if await reader.readuntil(b"\0") != b"zINSTREAM\0":
            writer.write(b"UNKNOWN COMMAND\0")
            return
        received = bytearray()
        while size := struct.unpack("!I", await reader.readexactly(4))[0]:
            received += await reader.readexactly(size)
        writer.write(b"stream: Eicar-Test-Signature FOUND\0" if EICAR in received else b"stream: OK\0")
        await writer.drain()
    finally:
        writer.close()


def start(port: int = 0) -> int:
    """Runs the stand-in on its own thread; returns the port it listens on (any free one for 0)."""
    ready: dict[str, int] = {}
    started = threading.Event()

    async def serve() -> None:
        server = await asyncio.start_server(_answer, "127.0.0.1", port)
        ready["port"] = server.sockets[0].getsockname()[1]
        started.set()
        async with server:
            await server.serve_forever()

    threading.Thread(target=lambda: asyncio.run(serve()), daemon=True).start()
    started.wait(5)
    return ready["port"]
