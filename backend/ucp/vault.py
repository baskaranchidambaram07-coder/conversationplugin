"""Secrets set through the admin API (M8-T4, T5): customers' shared secrets and PF connection profiles, sealed with
AES-GCM before they reach the database and opened only by the gateway when it needs them. The keys come from the
secret store (UCP_SECRETS_KEY), never from the database, so a copy of the database alone reveals nothing.

Each secret is sealed to its place, its tenant, kind and name, as associated data: moved to another tenant or name,
it no longer opens. The admin API never returns a sealed value; a new shared secret is shown once, when made.

    cd backend && uv run python -m ucp.vault new-key      a new key, as id:key, to put first in UCP_SECRETS_KEY

shortcut: a new key seals new and changed secrets only; the old key stays in UCP_SECRETS_KEY until every secret it
sealed has been set again. Add a re-seal command when a key must be retired faster.
"""

import base64
import os
import secrets
import sys
import time
from datetime import UTC, datetime

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Vault:
    """From the secret store, as "id:key,id:key" with 32-byte keys in base64url. The first one seals."""

    def __init__(self, keys: str):
        pairs = [entry.strip().split(":", 1) for entry in keys.split(",") if entry.strip()]
        try:
            self.keys = {kid: _key(value) for kid, value in pairs}
        except ValueError as error:
            raise ValueError("secrets keys are id:key, the key 32 bytes in base64url") from error
        if not pairs or any(len(key) != 32 for key in self.keys.values()):
            raise ValueError("secrets keys are id:key, the key 32 bytes in base64url")
        self.sealing = pairs[0][0]

    def seal(self, value: str, place: str) -> tuple[str, bytes, bytes]:
        """The key ID, nonce and sealed bytes for a value kept at `place` (tenant/kind/name)."""
        nonce = os.urandom(12)
        return self.sealing, nonce, AESGCM(self.keys[self.sealing]).encrypt(nonce, value.encode(), place.encode())

    def open(self, key_id: str, nonce: bytes, sealed: bytes, place: str) -> str:
        """The value, or ValueError when the key is not held or the value was not sealed for this place."""
        key = self.keys.get(key_id)
        if key is None:
            raise ValueError(f"no key {key_id} is held to open this secret")
        try:
            return AESGCM(key).decrypt(nonce, sealed, place.encode()).decode()
        except Exception as error:  # InvalidTag: tampered, or moved from where it was sealed
            raise ValueError("the secret does not open here") from error


def place(tenant_id: str, kind: str, name: str) -> str:
    return f"{tenant_id}/{kind}/{name}"


class Sealed:
    """The gateway's view of the secrets set through the admin API: a tenant's secret by name, opened and kept for
    30 seconds, so a change is in use within half a minute, as a published widget is."""

    TTL = 30.0

    def __init__(self, store, vault: Vault):
        self.store, self.vault = store, vault
        self.kept: dict[str, tuple[float, str | None]] = {}

    async def get(self, tenant_id: str, kind: str, name: str) -> str | None:
        where = place(tenant_id, kind, name)
        cached = self.kept.get(where)
        if cached and time.monotonic() - cached[0] < self.TTL:
            return cached[1]
        row = await self.store.sealed(tenant_id, kind, name)
        value = self.vault.open(row.key_id, row.nonce, row.sealed, where) if row else None
        if len(self.kept) > 10_000:
            self.kept.clear()
        self.kept[where] = (time.monotonic(), value)
        return value


def new_key() -> str:
    key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    return f"k{datetime.now(UTC):%Y%m%d}{secrets.token_hex(2)}:{key}"  # dated, and unique within the day


if __name__ == "__main__":
    if sys.argv[1:] != ["new-key"]:
        raise SystemExit("usage: python -m ucp.vault new-key")
    print(new_key())
