"""Makes the bundle a customer installs the Conversation Plugin from, in their own AWS account (M14-T4).

    python infra/aws/bundle.py VERSION

The image of that version must already be published and public (a tag vVERSION runs .github/workflows/release.yml;
infra/aws/README.md says how). Writes dist/conversation-plugin-aws-VERSION.zip: the Terraform, the scripts, the
sources of the access policies and the guide (SETUP.md, at its root), all from the tag vVERSION, with the image
pinned by its digest in infra/aws/stack/release.auto.tfvars.json. Everything in it is in this public repository.
"""

import argparse
import io
import json
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "ghcr.io/baskaranchidambaram07-coder/conversationplugin"  # where release.yml publishes
FILES = [
    "infra/aws/SETUP.md",
    "infra/aws/stack",
    "infra/aws/bootstrap/main.tf",
    "infra/aws/bootstrap/.terraform.lock.hcl",
    "infra/aws/environments/example.tfvars.json",
    "infra/aws/iam/ucp-dev-boundary.json",
    "infra/aws/iam/ucp-dev-deployer.json",
    "infra/aws/stack.py",
    "infra/aws/deploy.py",
    "infra/aws/console_admin.py",
    "infra/aws/secret_store.py",
]
MANIFESTS = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


def digest(image: str, tag: str) -> str:
    """The image's digest, read as anyone would pull it: no sign-in, so a private image fails here, not at the
    customer's."""
    repository = image.removeprefix("ghcr.io/")
    try:
        with urllib.request.urlopen(f"https://ghcr.io/token?scope=repository:{repository}:pull", timeout=20) as answer:
            token = json.load(answer)["token"]
        asked = urllib.request.Request(
            f"https://ghcr.io/v2/{repository}/manifests/{tag}",
            method="HEAD",
            headers={"Authorization": f"Bearer {token}", "Accept": MANIFESTS},
        )
        with urllib.request.urlopen(asked, timeout=20) as answer:  # noqa: S310 a fixed https address
            return answer.headers["Docker-Content-Digest"]
    except urllib.error.HTTPError as error:
        sys.exit(f"{image}:{tag} cannot be pulled without signing in ({error.code}): is it published, and public?")


def bundle(version: str, ref: str, image: str) -> Path:
    archive = subprocess.run(
        ["git", "-C", str(ROOT), "archive", "--format=zip", ref, "--", *FILES], check=True, capture_output=True
    ).stdout
    folder = f"conversation-plugin-aws-{version}/"
    out = ROOT / "dist" / f"conversation-plugin-aws-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            if not item.is_dir():
                name = "SETUP.md" if item.filename == "infra/aws/SETUP.md" else item.filename
                target.writestr(folder + name, source.read(item))
        target.writestr(folder + "infra/aws/stack/release.auto.tfvars.json", json.dumps({"image": image}) + "\n")
        target.writestr(folder + "VERSION", version + "\n")
    return out


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    arguments.add_argument("version", help="the version, as in its tag without the v, such as 1.0.0")
    version = arguments.parse_args().version
    image = f"{IMAGE}@{digest(IMAGE, version)}"
    out = bundle(version, f"v{version}", image)
    print(f"{out.relative_to(ROOT)}: version {version}, image {image}")
