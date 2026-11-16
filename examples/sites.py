"""The language samples: one small site per language (examples/html, php, java, dotnet, ruby, node, go, c, cpp). S3
cannot run code, so each language writes its page as plain HTML when the site is built, as a static site generator
does. Each site goes to the hosted samples' bucket under sites/NAME/, which a CloudFront address of its own serves
(infra/aws/stack/samples.tf), so a widget allowed on one site is refused on the others. No page carries the
assistant, so each can be onboarded by hand: put the script tag from the admin console where the page's comment says,
then publish.

python examples/sites.py               build with the languages this machine has, and check every page
python examples/sites.py --all         all nine, or fail (the pipeline)
python examples/sites.py --publish     all nine, uploaded to the dev stack; prints each site's address

Toolchains come from .tools on the build machine, else from the PATH. Publishing uses the AWS command line. A rebuilt
stack has new addresses and an empty bucket, so publish again after one.
"""

import argparse
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


def environment() -> dict[str, str]:
    env = dict(os.environ)
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


def build(work: Path, addresses: dict[str, str], every: bool) -> Path:
    """Writes each site into work/site/NAME, its page as index.html beside the stylesheet, and checks every page;
    returns work/site. The hub's {{NAME}} links become the sites' addresses."""
    hub = (HERE / "html/index.html").read_text(encoding="utf-8")
    if every and set(re.findall(r"\{\{([a-z]+)\}\}", hub)) != set(LANGUAGES):
        sys.exit("the hub page must link to every language's site, and only to those")
    pages = {"html": re.sub(r"\{\{([a-z]+)\}\}", lambda link: addresses[link[1]], hub)}
    env = environment()
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
        pages[language] = done.stdout
        print(f"built {language}")
    if missing:
        print("no toolchain here for " + ", ".join(missing))
        if every:
            sys.exit(1)
    site = work / "site"
    for name, text in pages.items():
        if not text.lstrip().startswith("<!doctype html>") or 'href="site.css"' not in text:
            sys.exit(f"{name}: not a whole page with the stylesheet")
        (site / name).mkdir(parents=True)
        (site / name / "index.html").write_text(text, "utf-8")
        shutil.copy(HERE / "html/site.css", site / name)
    return site


def main() -> None:
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--all", action="store_true", help="fail unless every language builds")
    arguments.add_argument("--publish", action="store_true", help="build all nine and upload them to the dev stack")
    args = arguments.parse_args()
    names = ["html", *LANGUAGES]
    addresses = {name: f"https://{name}.example" for name in names}
    if args.publish:
        sys.path.insert(0, str(ROOT / "infra/aws"))
        import deploy  # noqa: PLC0415 - the environment's names and addresses, only when publishing

        prefix = f"{deploy.NAME}-site-"  # each site's distribution is commented with its name (samples.tf)
        found = deploy.aws("cloudfront", "list-distributions")["DistributionList"].get("Items", [])
        addresses = {
            d["Comment"].removeprefix(prefix): f"https://{d['DomainName']}"
            for d in found
            if d["Comment"].startswith(prefix)
        }
        if set(addresses) != set(names):
            sys.exit("the sites have no addresses yet: apply the stack first (infra/aws/stack.py wake)")
    with tempfile.TemporaryDirectory() as work:
        site = build(Path(work), addresses, args.all or args.publish)
        if args.publish:
            buckets = deploy.aws("s3api", "list-buckets", "--prefix", f"{deploy.NAME}-samples-").get("Buckets", [])
            if len(buckets) != 1:
                sys.exit("no hosted samples bucket: the stack must be up with its samples (infra/aws/stack.py)")
            target = f"s3://{buckets[0]['Name']}/sites"  # --delete: sites/ holds only what this script writes
            sync = [
                "aws",
                "s3",
                "sync",
                str(site),
                target,
                "--delete",
                "--cache-control",
                "no-store",
                "--only-show-errors",
            ]
            subprocess.run([*sync, "--region", deploy.REGION], check=True)  # noqa: S603, S607
            for name in names:
                print(f"{name:7} {addresses[name]}")


if __name__ == "__main__":
    main()
