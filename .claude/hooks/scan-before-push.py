"""Claude Code hook: before a push, run the publish scan and block the push if it finds anything.

Runs before every shell command Claude issues and reads the tool call as JSON on stdin.
Exit code 2 blocks the call and shows the message to Claude; exit code 0 lets it through.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

# Also matches a commit message that mentions a push. That only costs one extra scan.
PUSH = re.compile(r"\bgit\b[^\n]*\bpush\b|\bgh\s+pr\s+create\b")
SCAN = Path(__file__).resolve().parents[2] / "scripts" / "scan-tracked-files.py"


def main():
    call = json.load(sys.stdin)
    if not PUSH.search(call.get("tool_input", {}).get("command", "")):
        return 0
    # Scan the checkout the command runs in, which may be a worktree. Outside a checkout, scan this one.
    top = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],  # noqa: S607 (git comes from PATH)
        cwd=call.get("cwd") or None,
        capture_output=True,
        text=True,
    )
    target = [top.stdout.strip()] if top.returncode == 0 else []
    result = subprocess.run([sys.executable, str(SCAN), *target], capture_output=True, text=True)  # noqa: S603
    if result.returncode != 0:
        print("Push blocked: the publish scan found something that must not be published.", file=sys.stderr)
        print(result.stdout + result.stderr, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
