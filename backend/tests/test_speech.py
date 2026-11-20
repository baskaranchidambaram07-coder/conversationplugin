"""Speech (M11), unit: how an answer is read aloud, and the fake speech service the other tests use."""

import asyncio
import io
import wave
from array import array

import pytest

from ucp.speech import FakeSpeech, NoSpeech, Reading, SpeechUnavailable, loud, silence

LOUD = array("h", [8000, -8000] * 1600).tobytes()  # 0.2 s of a loud tone
QUIET = bytes(6400)  # 0.2 s of silence


def read(*parts: str, whole: str | None = None) -> list[str]:
    reading = Reading()
    pieces = [piece for part in parts for piece in reading.feed(part)]
    return pieces + reading.end(whole if whole is not None else "".join(parts))


def test_the_first_sentence_is_read_on_its_own_before_its_line_has_even_ended():
    reading = Reading()
    assert reading.feed("The library opens at nine. It closes") == ["The library opens at nine."]
    assert reading.feed(" at ten on weekdays.\n\nOn Sundays it opens at noon.") == ["It closes at ten on weekdays."]
    assert reading.end("") == ["On Sundays it opens at noon."]  # the end repairs nothing it cannot match


def test_then_each_paragraph_is_one_piece_and_long_ones_are_gathered_about_250_characters_at_a_time():
    sentence = "This sentence is about fifty characters in length. "
    pieces = read("Hello.\n\n" + sentence * 12 + "\n\nBye.")
    assert pieces[0] == "Hello."
    assert all(len(piece) <= 260 for piece in pieces)
    assert pieces[-1] == "Bye."
    assert " ".join(pieces).split() == ("Hello. " + sentence * 12 + "Bye.").split()


def test_tables_code_diagrams_charts_formulas_and_drawings_are_named_not_read():
    answer = "\n".join(
        [
            "Here are the hours:",
            "| Day | Opens |",
            "| --- | --- |",
            "| Monday | 9 |",
            "",
            "```python",
            "print('never read')",
            "```",
            "```mermaid",
            "sequenceDiagram",
            "```",
            "```chart",
            '{"type": "bar"}',
            "```",
            "$$",
            "x^2",
            "$$",
            "┌──────┐",
            "│ Box  │",
            "└──────┘",
            "That is all.",
        ]
    )
    said = " ".join(read(answer))
    assert said == (
        "Here are the hours: There is a table in the chat. There is code in the chat. There is a diagram in the chat. "
        "There is a chart in the chat. There is a formula in the chat. There is a drawing in the chat. That is all."
    )


def test_markdown_marks_are_dropped_headings_and_items_pause_and_links_are_read_by_their_words():
    answer = (
        "## Opening hours\n- **Weekdays**: 9 to 10\n- Weekends\n> A quote\n---\n"
        "See [the library page](https://example.org/library) or https://example.org, and use `Book` there."
    )
    assert " ".join(read(answer)) == (
        "Opening hours. Weekdays: 9 to 10. Weekends. A quote See the library page or the link in the chat, "
        "and use Book there."
    )


def test_a_piece_is_never_longer_than_a_speech_service_takes():
    pieces = read("word " * 600)
    assert all(len(piece) <= Reading.LONGEST for piece in pieces)
    assert sum(len(piece.split()) for piece in pieces) == 600


def test_nothing_is_said_for_an_answer_with_nothing_to_say():
    assert read("") == []
    assert read("---\n\n") == []


def collect(heard) -> list[str]:
    async def run():
        return [text async for text in heard]

    return asyncio.run(run())


def frames(*parts: bytes):
    async def audio():
        for part in parts:
            yield part

    return audio()


def test_the_fake_hears_its_question_in_voiced_audio_a_word_at_a_time_and_nothing_in_silence():
    heard = collect(FakeSpeech().listen(frames(*[LOUD] * 8), "en-GB"))
    assert heard[0] == "When"
    assert heard[-1] == "When does the library open?"
    assert collect(FakeSpeech().listen(frames(*[QUIET] * 8), "en-GB")) == []
    assert collect(FakeSpeech().listen(frames(LOUD), "hi-IN")) == ["पुस्तकालय कब खुलता है?"]
    assert loud(LOUD) and not loud(QUIET) and not loud(b"")


def test_the_fake_speaks_silence_as_long_as_the_text_takes_and_no_service_listens_to_nothing():
    clip = asyncio.run(FakeSpeech().speak("Twenty characters!!", "en-GB"))
    with wave.open(io.BytesIO(clip)) as wav:
        assert wav.getnframes() / wav.getframerate() == pytest.approx(0.95, abs=0.01)
    assert silence(0)[:4] == b"RIFF"
    assert asyncio.run(NoSpeech().speak("Hello", "en-GB")) is None
    with pytest.raises(SpeechUnavailable):
        collect(NoSpeech().listen(frames(LOUD), "en-GB"))
