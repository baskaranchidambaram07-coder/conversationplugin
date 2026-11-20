"""Malware scanning (M10-T3): every attached file is scanned by ClamAV before it is kept or handed to the agent.

The gateway streams the bytes to clamd over TCP with its INSTREAM command, so the scanner runs beside it: a second
container in the task on AWS, a service container in CI, the stand-in in fakescan.py on a developer's machine. It
fails closed: with no scanner, or none that gives a verdict, the file is refused.
"""

import asyncio
import struct

CHUNK = 64 * 1024  # under clamd's default StreamMaxLength of 25 MB, whatever the file's size


class ScanUnavailable(Exception):
    """No verdict: no scanner set, none listening, or it answered with an error."""


async def scan(address: str | None, data: bytes, timeout: float = 30) -> str | None:
    """What clamd found in the bytes (its signature's name), or None when they are clean."""
    if not address:
        raise ScanUnavailable("no scanner configured")
    host, _, port = address.rpartition(":")
    try:
        async with asyncio.timeout(timeout):
            reader, writer = await asyncio.open_connection(host, int(port))
            try:
                writer.write(b"zINSTREAM\0")
                for start in range(0, len(data), CHUNK):
                    piece = data[start : start + CHUNK]
                    writer.write(struct.pack("!I", len(piece)) + piece)
                    await writer.drain()
                writer.write(struct.pack("!I", 0))
                await writer.drain()
                reply = (await reader.read(4096)).rstrip(b"\0\n").decode(errors="replace")
            finally:
                writer.close()
    except (OSError, TimeoutError, ValueError) as error:
        raise ScanUnavailable(type(error).__name__) from error
    if reply.endswith(" OK"):
        return None
    if reply.endswith(" FOUND"):
        return reply.removeprefix("stream: ").removesuffix(" FOUND")
    raise ScanUnavailable(reply[:200])  # e.g. "INSTREAM size limit exceeded. ERROR"
