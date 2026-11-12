"""Turns PF captures into the fake PF's recordings (plan task M0-T5), with every identifier replaced.

The captures in spikes/pf_capture_out/ hold staging identifiers and are never committed. The output in
backend/fakepf/recordings/ is committed, so every 24-character PF ID and every UUID is swapped for a stand-in
starting with zeros. The stand-ins the fake PF must swap for live values are listed at the top of each stream.

Run from the repository root:  python spikes/clean_pf_recordings.py
"""

import json
import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "pf_capture_out"
TARGET = Path(__file__).resolve().parent.parent / "backend" / "fakepf" / "recordings"
ID = re.compile(r"\b[0-9a-f]{24}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
ROLES = ("conversation_id", "message_id", "message_content_id", "workspace_id", "asset_version_id")

STREAMS = {  # output name: (capture run, stream step). Short: all words at once. Long: streamed steadily.
    "short": ("20261112-104302", "stream_1"),
    "long": ("20261112-110236", "stream_2"),
}
PROBES = "20261112-073917"
CREATE = "20261112-104302"


def stand_in(real, number):
    return f"{number:024x}" if len(real) == 24 else f"00000000-0000-4000-8000-{number:012x}"


class Cleaner:
    """Maps each real ID to a stand-in: the five roles get 0xa001 to 0xa005, any other ID 0xb001 onwards."""

    def __init__(self, roles):
        self.ids = {real: stand_in(real, 0xA001 + ROLES.index(role)) for role, real in roles.items()}
        self.others = 0

    def __call__(self, text):
        def swap(match):
            real = match.group()
            if real not in self.ids:
                self.ids[real] = stand_in(real, 0xB001 + self.others)
                self.others += 1
            return self.ids[real]

        clean = ID.sub(swap, text)
        assert not any(real in clean for real in self.ids), "an identifier survived"
        assert all(found.startswith("00000000") for found in ID.findall(clean))
        return clean


def stream(run, step):
    record = json.loads((SOURCE / f"{run}_capture.json").read_text(encoding="utf-8"))["steps"][step]
    raw = (SOURCE / f"{run}_{step}.txt").read_text(encoding="utf-8").encode()  # newline="" off: undo Windows CRLF
    assert len(raw) == record["bytes"], "the saved stream differs from what arrived"

    # Each event arrived with the network chunk that held its last byte.
    ends, total = [], 0
    for at_ms, size in record["arrivals_ms_and_size"]:
        total += size
        ends.append((total, at_ms))
    events, offset = [], 0
    for block in raw.decode().split("\n\n")[:-1]:
        offset += len(block.encode()) + 2
        events.append((next(at for end, at in ends if end >= offset), block.removeprefix("data: ")))

    details = json.loads(next(data for _, data in events if '"MESSAGE_DETAILS"' in data))
    roles = {role: details[role] for role in ROLES if role != "workspace_id"}
    roles["workspace_id"] = details["content"]["workspace_id"]
    clean = Cleaner(roles)
    header = [f": {role}={json.dumps(clean(value))}" for role, value in roles.items()]
    header.append(f": query={json.dumps(record['query'])}")
    body = [f": at_ms={at}\ndata: {clean(data)}\n" for at, data in events]
    return "\n".join(header) + "\n\n" + "\n".join(body)


def records():
    probes = json.loads((SOURCE / f"{PROBES}_probes.json").read_text(encoding="utf-8"))
    created = json.loads((SOURCE / f"{CREATE}_capture.json").read_text(encoding="utf-8"))["steps"]["create"]["body"]
    completed = json.loads(probes["final_by_message_id"]["body"])
    accepted = json.loads(probes["non_stream_addmessage"]["body"])
    found = {"conversation": created["conversation_details"], "accepted": accepted, "completed": completed}
    roles = {
        "conversation_id": completed["conversation_id"],
        "message_id": completed["message_id"],
        "message_content_id": completed["message_content"][0]["message_content_id"],
        "workspace_id": completed["workspace_id"],
        "asset_version_id": created["conversation_details"]["asset_version_id"],
    }
    return Cleaner(roles)(json.dumps(found, indent=2)) + "\n"


if __name__ == "__main__":
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, (run, step) in STREAMS.items():
        (TARGET / f"{name}.sse").write_text(stream(run, step), encoding="utf-8", newline="\n")
    (TARGET / "records.json").write_text(records(), encoding="utf-8", newline="\n")
    print(f"wrote {sorted(p.name for p in TARGET.iterdir())}")
