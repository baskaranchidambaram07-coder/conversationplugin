"""The language samples: one small site per language (examples/html, php, java, dotnet, ruby, node, go, c, cpp). S3
cannot run code, so each language writes its page as plain HTML when the site is built, as a static site generator
does. Each site has a CloudFront address of its own (infra/aws/sites, apart from the stack: it neither sleeps nor
wakes), so a widget allowed on one site is refused on the others. No page carries the assistant, so each can be
onboarded by hand: put the script tag from the admin console where the page's comment says, then publish.

python examples/sites.py               build with the languages this machine has, and check every page
python examples/sites.py --all         all nine, or fail (the pipeline)
python examples/sites.py --publish     make the bucket and the nine addresses if missing, upload all nine sites,
                                       print each site's address (the addresses stay the same on every publish)
python examples/sites.py --delete      remove the bucket and the nine addresses, after a demonstration

Toolchains come from .tools on the build machine, else from the PATH. Publishing and deleting use Terraform and the
AWS command line, signed in as the deploying identity, with the state in the dev stack's state bucket.
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


def terraform(*args: str, capture: bool = False) -> str:
    """The sites' own Terraform (infra/aws/sites), its state beside the dev stack's in the same state bucket."""
    environments = ROOT / "infra/aws/environments"
    data = environments / ".terraform" / "sites"
    env = {**os.environ, "TF_DATA_DIR": str(data), "TF_IN_AUTOMATION": "1"}
    local = TOOLS / "terraform" / ("terraform.exe" if os.name == "nt" else "terraform")
    if TOOLS.exists():
        (TOOLS / "terraform-plugins").mkdir(exist_ok=True)
        env["TF_PLUGIN_CACHE_DIR"] = str(TOOLS / "terraform-plugins")
    command = [str(local) if local.exists() else "terraform", f"-chdir={ROOT / 'infra/aws/sites'}"]
    if not (data / "terraform.tfstate").exists():  # first run on this machine: point it at the state bucket
        backend = environments / "dev.backend.hcl"
        if not backend.exists():
            sys.exit(f"no settings for the state bucket: {backend} (infra/aws/SETUP.md)")
        init = ["init", "-input=false", f"-backend-config={backend}", "-backend-config=key=sites/dev.tfstate"]
        subprocess.run([*command, *init], env=env, check=True, stdout=subprocess.DEVNULL)  # noqa: S603
    done = subprocess.run([*command, *args], env=env, check=True, text=True, capture_output=capture)  # noqa: S603
    return done.stdout if capture else ""


def main() -> None:
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("--all", action="store_true", help="fail unless every language builds")
    arguments.add_argument("--publish", action="store_true", help="make the nine addresses if missing, upload")
    arguments.add_argument("--delete", action="store_true", help="remove the bucket and the nine addresses")
    args = arguments.parse_args()
    if args.delete:
        terraform("destroy", "-auto-approve", "-input=false")
        return
    names = ["html", *LANGUAGES]
    addresses = {name: f"https://{name}.example" for name in names}
    if args.publish:  # the addresses first: the hub links to them
        terraform("apply", "-auto-approve", "-input=false")
        out = json.loads(terraform("output", "-json", capture=True))
        addresses = out["urls"]["value"]
    with tempfile.TemporaryDirectory() as work:
        site = build(Path(work), addresses, args.all or args.publish)
        if args.publish:
            target = f"s3://{out['bucket']['value']}"  # --delete: the bucket holds only what this script writes
            sync = ["aws", "s3", "sync", str(site), target, "--delete", "--cache-control", "no-store"]
            subprocess.run([*sync, "--only-show-errors", "--region", "us-east-1"], check=True)  # noqa: S603, S607
            for name in names:
                print(f"{name:7} {addresses[name]}")


if __name__ == "__main__":
    main()
