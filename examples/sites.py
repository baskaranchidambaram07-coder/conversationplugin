"""The language samples: one small site per language (examples/html, php, java, dotnet, ruby, node, go, c, cpp), each
page carrying the assistant's script tag. S3 cannot run code, so each language writes its page as plain HTML when the
site is built, as a static site generator does, and the pages go to the hosted samples' bucket under sites/.

python examples/sites.py               build with the languages this machine has, and check every page
python examples/sites.py --all         all nine, or fail (the pipeline)
python examples/sites.py --publish     all nine for the dev stack, uploaded; prints the address to open

Toolchains come from .tools on the build machine, else from the PATH. Publishing uses the AWS command line and puts
the pages beside the College's samples (infra/aws/stack/samples.tf), so they share that site's address; a rebuilt
stack has a new address and an empty bucket, so publish again after one.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TOOLS = ROOT / ".tools"
SCRIPT = '<script async src="{gateway}/loader.js" data-widget-id="{widget}"></script>'
# Each language's commands, run in examples/; the last one prints the page. {work} is a folder for compiled programs.
LANGUAGES = {
    "php": [["php", "php/index.php"]],
    "java": [["java", "java/Site.java"]],
    "dotnet": [["dotnet", "run", "--disable-build-servers", "--project", "dotnet"]],
    "ruby": [["ruby", "ruby/site.rb"]],
    "node": [["node", "node/site.mjs"]],
    "go": [["go", "run", "go/site.go"]],
    "c": [["gcc", "c/site.c", "-o", "{work}/c"], ["{work}/c"]],
    "cpp": [["g++", "cpp/site.cpp", "-o", "{work}/cpp"], ["{work}/cpp"]],
}


def environment(gateway: str, widget: str) -> dict[str, str]:
    env = {**os.environ, "UCP_GATEWAY": gateway, "UCP_WIDGET_ID": widget}
    if TOOLS.exists():  # the build machine: portable toolchains, and every cache they write kept inside .tools
        home = TOOLS / "home"
        roaming, local = home / "AppData/Roaming", home / "AppData/Local"
        for folder in (roaming, local):  # .NET asks Windows for these; a missing one becomes the current folder
            folder.mkdir(parents=True, exist_ok=True)
        bins = ("php", "jdk/bin", "dotnet", "ruby/bin", "go/bin", "mingw64/bin")
        env["PATH"] = os.pathsep.join([*(str(TOOLS / b) for b in bins), env["PATH"]])
        env.update(USERPROFILE=str(home), HOME=str(home), APPDATA=str(roaming), LOCALAPPDATA=str(local))
        env.update(DOTNET_CLI_TELEMETRY_OPTOUT="1", DOTNET_NOLOGO="1")
    return env


def build(work: Path, gateway: str, widget: str, every: bool) -> Path:
    """Writes the site into work/site and checks every page; returns the folder."""
    site = work / "site"
    site.mkdir()
    shutil.copy(HERE / "html/site.css", site)
    hub = (HERE / "html/index.html").read_text(encoding="utf-8")
    (site / "index.html").write_text(hub.replace("{{GATEWAY}}", gateway).replace("{{WIDGET}}", widget), "utf-8")
    env = environment(gateway, widget)
    missing = []
    for language, commands in LANGUAGES.items():
        if not shutil.which(commands[0][0], path=env["PATH"]):
            missing.append(language)
            continue
        for command in commands:
            run = [part.replace("{work}", str(work)) for part in command]
            run[0] = shutil.which(run[0], path=env["PATH"]) or run[0]  # Windows finds programs on our PATH, not env's
            done = subprocess.run(run, cwd=HERE, env=env, capture_output=True, encoding="utf-8", timeout=600)  # noqa: S603
            if done.returncode:
                sys.exit(f"{language}: {(done.stdout + done.stderr).strip()[-800:]}")  # dotnet reports on stdout
        (site / f"{language}.html").write_text(done.stdout, "utf-8")
        print(f"built {language}")
    if missing:
        print("no toolchain here for " + ", ".join(missing))
        if every:
            sys.exit(1)
    tag = SCRIPT.format(gateway=gateway, widget=widget)
    for page in site.glob("*.html"):
        text = page.read_text(encoding="utf-8")
        if not text.lstrip().startswith("<!doctype html>") or tag not in text or 'href="site.css"' not in text:
            sys.exit(f"{page.name} is not a whole page with the stylesheet and the assistant's script tag")
    if every:
        linked = set(re.findall(r'href="([a-z]+\.html)"', hub))
        if linked != {f"{language}.html" for language in LANGUAGES}:
            sys.exit("the hub page must link to every language's page, and only to those")
    return site


def main() -> None:
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--all", action="store_true", help="fail unless every language builds")
    arguments.add_argument("--publish", action="store_true", help="build all nine for the dev stack and upload them")
    args = arguments.parse_args()
    gateway, widget = "https://assistant.example", "w_sample"
    if args.publish:
        sys.path.insert(0, str(ROOT / "infra/aws"))
        import deploy  # noqa: PLC0415 - the environment's names and addresses, only when publishing

        gateway = deploy.public_url()
        widgets = json.loads((ROOT / "backend/deploy/widgets.dev.json").read_text(encoding="utf-8"))["widgets"]
        # The widget the College's public sample uses (samples.tf): anonymous chat, allowed on the samples' address.
        widget = next(id_ for id_, w in widgets.items() if w.get("identity", {}).get("secret") == "college")
    with tempfile.TemporaryDirectory() as work:
        site = build(Path(work), gateway, widget, args.all or args.publish)
        if args.publish:
            buckets = deploy.aws("s3api", "list-buckets", "--prefix", f"{deploy.NAME}-samples-").get("Buckets", [])
            if len(buckets) != 1:
                sys.exit("no hosted samples bucket: the stack must be up with its samples (infra/aws/stack.py)")
            target = f"s3://{buckets[0]['Name']}/sites"
            sync = ["aws", "s3", "sync", str(site), target, "--cache-control", "no-store", "--only-show-errors"]
            subprocess.run([*sync, "--region", deploy.REGION], check=True)  # noqa: S603, S607
            print(f"{deploy.public_url('UCP_SAMPLES_ORIGIN')}/sites/index.html")


if __name__ == "__main__":
    main()
