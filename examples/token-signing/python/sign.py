"""Signs a widget token for your signed-in user. Python 3.8 or later, standard library only.

    UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... python sign.py <user id>

Call widget_token(user_id) from the endpoint your page's getToken fetches, after checking the user is signed in.
The user ID must be your stable ID for the user, never an email address or a name.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time


def _part(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def widget_token(user_id: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    if os.environ.get("UCP_SECRET_ID"):
        header["kid"] = os.environ["UCP_SECRET_ID"]  # which secret signed it, while two are in use
    claims = {
        "iss": os.environ["UCP_ISSUER"],
        "aud": os.environ["UCP_WIDGET_ID"],
        "sub": user_id,
        "iat": now,
        "exp": now + 300,  # five minutes; the chat asks again when it needs a new one
        "jti": secrets.token_urlsafe(16),  # used once only
    }
    signed = f"{_part(json.dumps(header).encode())}.{_part(json.dumps(claims).encode())}"
    signature = hmac.new(os.environ["UCP_WIDGET_SECRET"].encode(), signed.encode(), hashlib.sha256).digest()
    return f"{signed}.{_part(signature)}"


if __name__ == "__main__":
    print(widget_token(sys.argv[1]))
