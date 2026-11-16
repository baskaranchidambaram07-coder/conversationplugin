"""A stand-in identity provider for tests: OpenID Connect discovery and published keys, as Entra ID, Okta or Keycloak
serve them, with keys it can rotate and an outage it can be put into."""

import time

import jwt
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import FastAPI
from fastapi.responses import JSONResponse


class FakeProvider:
    def __init__(self):
        self.base_url = ""
        self.private: dict[str, object] = {}
        self.published: list[str] = []
        self.down = False
        self.key_fetches = 0
        self.add("rsa-1", "RS256")
        self.add("ec-1", "ES256")

    def add(self, kid: str, algorithm: str) -> None:
        self.private[kid] = (
            ec.generate_private_key(ec.SECP256R1())
            if algorithm.startswith("ES")
            else rsa.generate_private_key(65537, 2048)
        )
        self.published.append(kid)

    def token(self, *, kid: str = "rsa-1", algorithm: str = "RS256", audience: str = "chat-widget", **changes) -> str:
        now = int(time.time())
        claims = {"iss": self.base_url, "aud": audience, "sub": "resident-42", "iat": now, "exp": now + 3600, **changes}
        claims = {name: value for name, value in claims.items() if value is not None}
        return jwt.encode(claims, self.private[kid], algorithm=algorithm, headers={"kid": kid})

    def app(self) -> FastAPI:
        app = FastAPI()

        @app.get("/.well-known/openid-configuration")
        async def discovery():
            if self.down:
                return JSONResponse({}, status_code=503)
            return {
                "issuer": self.base_url,
                "jwks_uri": f"{self.base_url}/keys",
                "authorization_endpoint": f"{self.base_url}/authorize",
                "token_endpoint": f"{self.base_url}/token",
            }

        @app.get("/keys")
        async def keys():
            if self.down:
                return JSONResponse({}, status_code=503)
            self.key_fetches += 1
            published = []
            for kid in self.published:
                key = self.private[kid].public_key()
                kind = (
                    jwt.algorithms.ECAlgorithm
                    if isinstance(key, ec.EllipticCurvePublicKey)
                    else jwt.algorithms.RSAAlgorithm
                )
                published.append({**kind.to_jwk(key, as_dict=True), "kid": kid, "use": "sig"})
            return {"keys": published}

        return app
