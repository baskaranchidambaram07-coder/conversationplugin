"""Fails if a value from .env, or anything shaped like a key or token, appears in a file git would publish.

The repository is public, so run this before every push:  python scripts/scan-tracked-files.py
Pass a folder to scan another checkout of the repository, such as a worktree.
"""

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
PATTERNS = {
    "AWS access key": r"AKIA[0-9A-Z]{16}",
    "signed token": r"eyJ[A-Za-z0-9_-]{20,}",
    "AWS account number": r"arn:aws:[a-z0-9-]*:[a-z0-9-]*:\d{12}:",
}


def env_file():
    """This checkout's .env, or the main checkout's when this one is a worktree. None on a fresh clone."""
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],  # noqa: S607 (git comes from PATH)
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    candidates = [ROOT / ".env"]
    if common.returncode == 0:
        candidates.append(Path(common.stdout.strip()).parent / ".env")
    return next((path for path in candidates if path.exists()), None)


def env_needles():
    """Every .env value, its host name if it is an address, and its long secret-looking parts.

    The parts catch a password inside a connection address. A part made only of letters is skipped:
    it is an ordinary word (one key begins with a public path word), not a secret.
    """
    needles, env = {}, env_file()
    if env is None:
        print("no .env found, so only the key and token patterns were checked")
        return needles
    for line in env.read_text(encoding="utf-8-sig").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip("\"'")
        if len(value) >= 8:
            needles[value] = key
        host = urlsplit(value).hostname
        if host and "." in host and host != "127.0.0.1":
            needles[host] = key
        for part in re.split(r"[^A-Za-z0-9_-]+", value):
            if len(part) >= 12 and any(c.isdigit() for c in part):
                needles[part] = key
    return needles


def publishable_files():
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],  # noqa: S607 (git comes from PATH)
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    return [ROOT / name for name in listed if (ROOT / name).is_file()]


def main():
    needles, findings = env_needles(), []
    for path in publishable_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        name = path.relative_to(ROOT).as_posix()
        findings += [f"{name}: contains the value of {key}" for needle, key in needles.items() if needle in text]
        findings += [
            f"{name}: contains something shaped like an {label}"
            for label, pattern in PATTERNS.items()
            if re.search(pattern, text)
        ]
    for finding in sorted(set(findings)):
        print(finding)
    print(f"{len(publishable_files())} files scanned, {len(set(findings))} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
