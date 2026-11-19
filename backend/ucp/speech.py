"""Speech (M11): the two interfaces between the gateway and a speech service, kept separate (M11-T1), and how an
answer is read aloud.

A `Listener` turns a visitor's audio into text as they speak. A `Speaker` turns a piece of an answer into audio.
`Reading` turns an answer's Markdown, as it streams, into the pieces a speaker reads. PF itself has no speech: speech
happens before the question reaches it and after its answer leaves it (docs/voice.md).
"""

import io
import logging
import re
import wave
from array import array
from collections.abc import AsyncIterator
from typing import Literal, Protocol

log = logging.getLogger("ucp.speech")

RATE = 16_000  # audio from the chat: 16 kHz, 16-bit, mono, little-endian PCM
BYTES_PER_SECOND = RATE * 2


class SpeechUnavailable(Exception):
    """No speech service is set up, or it could not be reached. `detail` is for our logs only."""


class Listener(Protocol):
    def listen(self, audio: AsyncIterator[bytes], language: str) -> AsyncIterator[str]:
        """Everything heard so far, each time it grows. Ends when the audio ends; the last text is the final one.
        Raises SpeechUnavailable if the service cannot listen."""
        ...


class Speaker(Protocol):
    async def speak(self, text: str, language: str) -> bytes | None:
        """The text read aloud, as an MP3 or WAV clip; None where it cannot be voiced, so the chat reads it with the
        browser's own voice."""
        ...


class NoSpeech:
    """No speech service: the chat listens and speaks with the browser's own engines, where it may."""

    async def listen(self, audio: AsyncIterator[bytes], language: str) -> AsyncIterator[str]:
        raise SpeechUnavailable("no speech service is set up")
        yield ""  # pragma: no cover - makes this an async generator

    async def speak(self, text: str, language: str) -> bytes | None:
        return None


PHRASES = {  # what the fake hears in any voiced audio, by language
    "en": "When does the library open?",
    "hi": "पुस्तकालय कब खुलता है?",
    "fr": "Quand la bibliothèque ouvre-t-elle ?",
    "es": "¿Cuándo abre la biblioteca?",
}


def loud(frame: bytes) -> bool:
    """Whether a frame of PCM holds speech rather than silence: its root mean square over about 1.5% of full scale."""
    samples = array("h", frame[: len(frame) // 2 * 2])
    return bool(samples) and sum(s * s for s in samples) / len(samples) > 500**2


def silence(seconds: float) -> bytes:
    """A WAV clip of silence, 8 kHz mono."""
    out = io.BytesIO()
    with wave.open(out, "wb") as clip:
        clip.setnchannels(1)
        clip.setsampwidth(2)
        clip.setframerate(8000)
        clip.writeframes(b"\0\0" * int(8000 * seconds))
    return out.getvalue()


class FakeSpeech:
    """For tests and the browser journeys: hears a fixed question in any voiced audio, a word for every 0.3 s of it,
    and speaks silence as long as the text would take to say."""

    async def listen(self, audio: AsyncIterator[bytes], language: str) -> AsyncIterator[str]:
        words = PHRASES.get(language.split("-")[0], PHRASES["en"]).split()
        voiced, said = 0.0, 0
        async for frame in audio:
            if loud(frame):
                voiced += len(frame) / BYTES_PER_SECOND
            heard = min(len(words), int(voiced / 0.3))
            if heard > said:
                said = heard
                yield " ".join(words[:heard])
        if voiced and said < len(words):
            yield " ".join(words)

    async def speak(self, text: str, language: str) -> bytes | None:
        return silence(min(4.0, 0.05 * len(text)))


def speech_service(kind: Literal["none", "fake", "aws"], region: str = "", client=None) -> tuple[Listener, Speaker]:
    """The listener and speaker the gateway uses, from UCP_SPEECH."""
    if kind == "fake":
        return FakeSpeech(), FakeSpeech()
    if kind == "aws":
        from ucp.aws_speech import Polly, Transcribe

        return Transcribe(region), Polly(region, client)
    return NoSpeech(), NoSpeech()


# Reading an answer aloud. Answers are Markdown with tables, code, charts and diagrams: these are not read out but
# named in one short sentence, and Markdown's marks are dropped.

FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})\s*([\w+#-]*)")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s+")
ITEM = re.compile(r"^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?")
QUOTE = re.compile(r"^\s{0,3}(?:>\s?)+")
RULE = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$")
LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
ADDRESS = re.compile(r"\bhttps?://\S*[^\s.,;:!?'\")\]]")  # without the punctuation after it
CODE = re.compile(r"`+([^`]*)`+")
TAG = re.compile(r"</?[A-Za-z][^>]*>")
MARKS = re.compile(r"\*\*|__|\*|~~")
BOX = re.compile(r"[─-╿]")
ENDS = re.compile(r"[.!?…:;](?=[\s\"')\]]|$)")
SPLIT = re.compile(r"(?<=[.!?…])\s+(?=\S)")

NOTICES = {
    "code": "There is code in the chat.",
    "diagram": "There is a diagram in the chat.",
    "chart": "There is a chart in the chat.",
    "formula": "There is a formula in the chat.",
    "table": "There is a table in the chat.",
    "drawing": "There is a drawing in the chat.",
}
DIAGRAMS = {"mermaid", "drawio", "excalidraw"}
FORMULAS = {"math", "latex", "tex"}


def plain(text: str) -> str:
    """Words as they are said: links by their words, addresses named, code, tags and emphasis marks dropped."""
    text = LINK.sub(r"\1", text)
    text = ADDRESS.sub("the link in the chat", text)
    text = CODE.sub(r"\1", text)
    text = TAG.sub("", text)
    return " ".join(MARKS.sub("", text).split())


class Reading:
    """An answer's Markdown, fed as it streams, cut into the pieces to read aloud: the first sentence on its own, so
    the voice starts soon, then each paragraph, or about 250 characters of one, at a time."""

    MOST = 250  # characters a piece gathers before it is read, once the first sentence is out
    LONGEST = 1000  # a piece is never longer: a speech service takes a few thousand characters at most

    def __init__(self):
        self.markdown = ""
        self.read = 0  # characters of the Markdown already turned into words
        self.fence: str | None = None  # the open fence's marks, while in a fenced block
        self.inside: str | None = None  # "table", "formula" or "drawing", while in one
        self.midline = False  # part of the current line was read early
        self.waiting: list[str] = []  # sentences not yet in a piece
        self.started = False

    def feed(self, text: str) -> list[str]:
        self.markdown += text
        return self._take(final=False)

    def end(self, whole: str) -> list[str]:
        """The whole answer, which may repair what streamed: only what was not yet read is read."""
        if whole.startswith(self.markdown[: self.read]):
            self.markdown = whole
        return self._take(final=True)

    def _take(self, final: bool) -> list[str]:
        pieces: list[str] = []
        while (newline := self.markdown.find("\n", self.read)) != -1:
            line = self.markdown[self.read : newline]
            self.read = newline + 1
            self.waiting += self._line(line)
            self.midline = False
            pieces += self._gather(paragraph=not line.strip())
        tail = self.markdown[self.read :]
        if final:
            self.read = len(self.markdown)
            self.waiting += self._line(tail)
            pieces += self._gather(paragraph=True)
        elif tail and self._prose(tail) and (end := list(ENDS.finditer(tail))):
            # Whole sentences of a line still arriving are read now, without waiting for its end.
            part = tail[: end[-1].end()]
            self.read += len(part)
            self.waiting += self._line(part)
            self.midline = True
            pieces += self._gather(paragraph=False)
        return pieces

    def _prose(self, tail: str) -> bool:
        if self.fence or self.inside:
            return False
        return self.midline or not (FENCE.match(tail) or HEADING.match(tail) or tail.lstrip().startswith(("|", "$$")))

    def _line(self, line: str) -> list[str]:
        """The sentences to say for one line, or none, keeping track of the blocks it opens and closes."""
        if self.fence:
            if line.strip().startswith(self.fence):
                self.fence = None
            return []
        if fence := FENCE.match(line):
            self.fence, language = fence.group(1), fence.group(2).lower()
            kind = "diagram" if language in DIAGRAMS else "chart" if language == "chart" else "code"
            return [NOTICES["formula" if language in FORMULAS else kind]]
        stripped = line.strip()
        if self.inside == "formula":
            if stripped.endswith("$$"):
                self.inside = None
            return []
        block = "table" if stripped.startswith("|") else "drawing" if BOX.search(line) else None
        if stripped.startswith("$$"):
            self.inside = None if len(stripped) > 2 and stripped.endswith("$$") else "formula"
            return [NOTICES["formula"]]
        if block:
            said = [] if self.inside == block else [NOTICES[block]]
            self.inside = block
            return said
        self.inside = None
        if not self.midline:
            if RULE.match(line):
                return []
            listed = bool(HEADING.match(line) or ITEM.match(line))
            line = QUOTE.sub("", ITEM.sub("", HEADING.sub("", line)))
        else:
            listed = False
        words = plain(line)
        if not words:
            return []
        if listed and not ENDS.search(words[-1]):
            words += "."  # a heading or an item ends where the voice pauses
        return [sentence for sentence in SPLIT.split(words) if sentence]

    def _gather(self, paragraph: bool) -> list[str]:
        pieces: list[str] = []
        if self.waiting and not self.started:
            pieces.append(self.waiting.pop(0))
            self.started = True
        while self.waiting and (paragraph or len(" ".join(self.waiting)) >= self.MOST):
            taken: list[str] = []
            while self.waiting and (not taken or len(" ".join([*taken, self.waiting[0]])) <= self.MOST):
                taken.append(self.waiting.pop(0))
            pieces.append(" ".join(taken))
        return [cut for piece in pieces for cut in _cut(piece, self.LONGEST)]


def _cut(text: str, most: int) -> list[str]:
    """A piece over `most` characters, cut at spaces."""
    out: list[str] = []
    while len(text) > most:
        at = text.rfind(" ", 0, most)
        at = at if at > 0 else most
        out.append(text[:at])
        text = text[at:].lstrip()
    return [*out, text] if text else out
