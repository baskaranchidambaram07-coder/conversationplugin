"""Runs every token-signing snippet with the shared test settings and checks each token exactly as the gateway does.

cd backend && uv run python ../examples/token-signing/check.py              the languages this machine has
cd backend && uv run python ../examples/token-signing/check.py --all        all six, or fail (the pipeline)
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "backend"))  # the gateway's own check, not a copy of it

from ucp.identity import Identity, verify_shared_secret  # noqa: E402

SETTINGS = json.loads((HERE / "test-settings.json").read_text(encoding="utf-8"))
COMMANDS = {
    "Python": [sys.executable, "python/sign.py"],
    "Node": ["node", "node/sign.mjs"],
    "Java": ["java", "java/Sign.java"],
    ".NET": ["dotnet", "run", "--project", "dotnet", "--"],
    "PHP": ["php", "php/sign.php"],
    "Go": ["go", "run", "go/sign.go"],
}


def sign(command: list[str], named: bool) -> str:
    env = {
        **os.environ,
        "UCP_WIDGET_SECRET": SETTINGS["secret"],
        "UCP_ISSUER": SETTINGS["issuer"],
        "UCP_WIDGET_ID": SETTINGS["widget_id"],
        "UCP_SECRET_ID": SETTINGS["secret_id"] if named else "",
    }
    run = [*command, SETTINGS["user_id"]]  # our own fixed commands, never input from outside
    done = subprocess.run(run, cwd=HERE, env=env, capture_output=True, text=True, timeout=300)  # noqa: S603
    if done.returncode:
        raise RuntimeError(done.stderr.strip()[-500:])
    return done.stdout.strip().splitlines()[-1]


def check(language: str) -> None:
    identity = Identity(provider="snippets", issuer=SETTINGS["issuer"], secret="test")  # noqa: S106 - a name
    keys = {SETTINGS["secret_id"]: SETTINGS["secret"].encode()}
    seen = set()
    for named in (True, False):  # with the secret's ID, and without it
        token = sign(COMMANDS[language], named)
        user, token_id, _ = verify_shared_secret(token, identity, SETTINGS["widget_id"], keys)
        if user != SETTINGS["user_id"]:
            raise ValueError(f"the user came back as {user!r}")
        seen.add(token_id)
    if len(seen) != 2:
        raise ValueError("two tokens shared one jti")


def main() -> int:
    every = "--all" in sys.argv
    failed = False
    for language, command in COMMANDS.items():
        if not shutil.which(command[0]):
            print(f"{'FAILED' if every else 'skipped'}  {language}: {command[0]} is not installed")
            failed |= every
            continue
        try:
            check(language)
            print(f"ok      {language}")
        except Exception as error:  # noqa: BLE001 - any failure is reported, then the next language is tried
            print(f"FAILED  {language}: {error}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
