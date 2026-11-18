"""The Purple Fabric connector (the core of M6, built with M4): the only code that knows PF's conversation API, as
observed and written up in docs/pf-capability-sheet.md.

What PF does that shapes this code:
- A failed login and a failed stream both arrive with success statuses, so the body is read, never the status alone.
- Every stream event carries PF's IDs, and the final one carries cost; only answer text and usage leave here.
- The `message_id` on MESSAGE_DETAILS is the real one; later events carry a content ID under the same name.
- PF finishes an answer even when the stream breaks, so a broken stream is recovered by fetching the answer.
- Tokens last as long as PF says; a second login does not cancel the first, so each gateway instance logs in alone.
"""

import asyncio
import json
import time
from collections.abc import Sequence

import httpx2
from pydantic import BaseModel, ConfigDict, SecretStr

from ucp.connector import Accepted, AgentError, AgentEvent, AgentFile, Failed, Final, Text
from ucp.gateway.pipeline import correlation

API = "/magicplatform/v1/genai/conversation"
REFRESH_EARLY = 300  # log in again this many seconds before PF's stated expiry
LOGIN_PAUSE = 300  # after PF refuses the credentials, try them again only this long after: repeats lock the account
FILE_SECONDS = 90  # PF read a file in 4 to 9 s on staging; this long, and the turn fails
SUMMARY_GRACE = 20  # a processed file still without a summary this long after is asked about anyway


class PfProfile(BaseModel):
    """A connection profile, from the secret store. Nothing in it is ever sent to the browser or logged."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    base_url: str
    tenant: str
    workspace_id: str
    agent_version_id: str
    api_key: SecretStr
    username: str
    password: SecretStr


def _usage(content: dict) -> dict[str, float]:
    metrics = content.get("metrics") or {}
    names = ("prompt_tokens", "completion_tokens", "total_tokens", "total_cost")
    return {name: float(metrics[name]) for name in names if isinstance(metrics.get(name), int | float)}


def _failure(status: object, where: str) -> Failed:
    if status == 429:
        return Failed("rate_limited", True, f"{where}: PF status 429")
    return Failed("assistant_unavailable", isinstance(status, int) and status >= 500, f"{where}: PF status {status}")


def _event(line: str) -> AgentEvent | None:
    """One line of PF's stream as our event, or None for the ones we do not use (notices, start and end markers, new
    kinds) and for a damaged one: the final event carries the whole answer, so a lost piece costs nothing."""
    try:
        data = json.loads(line.removeprefix("data:"))
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    kind, content = data.get("event"), data.get("content")
    if kind == "MESSAGE_DETAILS":
        return Accepted(str(data["message_id"]))
    if kind == "LLM_RESPONSE_STREAM" and data.get("status") == "IN_PROGRESS" and isinstance(content, str) and content:
        return Text(content)
    if kind == "FINAL_RESPONSE":
        return Final(str(content["response"]), _usage(content))
    if kind == "ERROR":
        return _failure(content.get("status_code") if isinstance(content, dict) else None, "stream")
    return None


class PfConnector:
    def __init__(
        self,
        profile: PfProfile,
        client: httpx2.AsyncClient,
        *,
        recover_seconds: float = 120,
        poll_seconds: float = 2,
        file_seconds: float = FILE_SECONDS,
        file_poll_seconds: float = 1,
    ):
        self.profile, self.client = profile, client
        self.version = profile.agent_version_id
        self.recover_seconds, self.poll_seconds = recover_seconds, poll_seconds
        self.file_seconds, self.file_poll_seconds = file_seconds, file_poll_seconds
        self._token: str | None = None
        self._expires = 0.0
        self._refused_until = 0.0
        self._lock = asyncio.Lock()

    # Logging in

    async def _login(self, stale: str | None = None) -> str:
        """The current token. `stale` is a token PF just refused: log in again unless someone already has.
        Concurrent callers share one login."""
        async with self._lock:
            fresh = self._token and self._token != stale and time.monotonic() < self._expires - REFRESH_EARLY
            if fresh:
                return self._token
            if time.monotonic() < self._refused_until:
                raise AgentError("assistant_unavailable", False, "login refused recently, not tried again yet")
            profile = self.profile
            headers = {
                "apikey": profile.api_key.get_secret_value(),
                "username": profile.username,
                "password": profile.password.get_secret_value(),
            }
            try:
                reply = await self.client.get(f"{profile.base_url}/accesstoken/{profile.tenant}", headers=headers)
                body = reply.json()
            except (httpx2.HTTPError, ValueError) as error:
                raise AgentError("assistant_unavailable", True, f"login: {type(error).__name__}") from error
            if not isinstance(body, dict) or body.get("result") != "RESULT_SUCCESS" or not body.get("access_token"):
                self._refused_until = time.monotonic() + LOGIN_PAUSE
                raise AgentError("assistant_unavailable", False, f"login refused (HTTP {reply.status_code})")
            self._token = body["access_token"]
            self._expires = time.monotonic() + float(body.get("expires_in", 0))
            return self._token

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "apikey": self.profile.api_key.get_secret_value(),
            "X-Platform-Workspaceid": self.profile.workspace_id,
            "authorization": f"Bearer {token}",
            "x-request-id": correlation.get(),  # our reference, so one question can be followed into PF's logs
        }

    async def _call(self, method: str, path: str, body: dict | None = None, **raw) -> httpx2.Response:
        """A plain call, logging in again once if PF refuses the token. `raw` passes params, or a multipart body
        (files and data), instead of a JSON one."""
        token = await self._login()
        for attempt in (1, 2):
            try:
                reply = await self.client.request(
                    method, f"{self.profile.base_url}{path}", json=body, headers=self._headers(token), **raw
                )
            except httpx2.HTTPError as error:
                raise AgentError("assistant_unavailable", True, f"{method} {path}: {type(error).__name__}") from error
            if reply.status_code != 401 or attempt == 2:
                return reply
            token = await self._login(stale=token)
        raise AssertionError("unreachable")

    # The connector interface

    async def check(self) -> None:
        await self._login(stale=self._token)

    async def create_conversation(self, name: str) -> str:
        body = {"asset_version_id": self.profile.agent_version_id, "conversation_name": name}
        reply = await self._call("POST", f"{API}/create", body)
        if reply.status_code >= 300:
            failure = _failure(reply.status_code, "create")
            raise AgentError(failure.code, failure.retryable, failure.detail)
        try:
            return str(reply.json()["conversation_details"]["conversation_id"])
        except (ValueError, KeyError, TypeError) as error:
            raise AgentError("assistant_unavailable", False, "create: unexpected reply") from error

    async def _upload(self, conversation_id: str, file: AgentFile) -> str:
        """Puts one file into the conversation, where PF's agent finds it by itself: a question never names it (PF
        refuses `ref_file_ids`). Returns PF's ID for it (pf-capability-sheet.md section 4a)."""
        reply = await self._call(
            "POST",
            f"{API}/fileupload",
            params={"conversation_id": conversation_id},
            files={"files": (file.name, file.data, file.content_type)},
            data={"doc_source": "UPLOAD"},
        )
        if reply.status_code >= 300:
            failure = _failure(reply.status_code, "upload")
            raise AgentError(failure.code, failure.retryable, failure.detail)
        try:
            return str(reply.json()[0]["file_id"])
        except (ValueError, KeyError, TypeError, IndexError) as error:
            raise AgentError("assistant_unavailable", False, "upload: unexpected reply") from error

    async def _read(self, conversation_id: str, file_ids: list[str]) -> None:
        """Waits until PF has read every file: processed, then summarised. Its agent finds a file's text only once the
        summary exists; asked at FILE_PROCESS_SUCCESS alone, it could not (seen on staging, 18 November 2026). A file PF
        cannot read, or files not read in time, fail the turn; asking again would not help."""
        deadline = time.monotonic() + self.file_seconds
        processed: dict[str, float] = {}  # when each file was first seen processed
        while True:
            reply = await self._call("GET", f"{API}/details/{conversation_id}")
            if reply.status_code >= 300:
                failure = _failure(reply.status_code, "file details")
                raise AgentError(failure.code, False, failure.detail)
            try:
                found = {item["file_id"]: item for item in reply.json().get("file_details") or []}
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                raise AgentError("assistant_unavailable", False, "file details: unexpected reply") from error
            waiting = False
            for file_id in file_ids:
                item = found.get(file_id, {})
                status = str(item.get("file_status", ""))
                if "FAIL" in status or "ERROR" in status:  # shortcut: PF's failure names are unknown; any such word
                    raise AgentError("assistant_unavailable", False, f"PF could not read a file: {status}")
                if "PROCESS_SUCCESS" in status:
                    since = processed.setdefault(file_id, time.monotonic())
                    if item.get("summary") or time.monotonic() - since > SUMMARY_GRACE:
                        continue
                waiting = True
            if not waiting:
                return
            if time.monotonic() > deadline:
                raise AgentError("assistant_unavailable", False, f"files not read within {self.file_seconds:.0f} s")
            await asyncio.sleep(self.file_poll_seconds)

    async def send(self, conversation_id: str, text: str, files: Sequence[AgentFile] = ()):
        accepted: Accepted | None = None
        try:
            file_ids = [await self._upload(conversation_id, file) for file in files]
            if file_ids:
                await self._read(conversation_id, file_ids)
        except AgentError as error:
            yield Failed(error.code, error.retryable, error.detail)  # PF never had the question: asking again is safe
            return
        try:
            async for event in self._stream(conversation_id, text):
                yield event
                if isinstance(event, Accepted):
                    accepted = event
                if isinstance(event, Final | Failed):
                    return
            why = "the stream ended without an answer"
        except AgentError as error:
            yield Failed(error.code, error.retryable, error.detail)
            return
        except (httpx2.HTTPError, ValueError, KeyError, TypeError) as error:
            why = f"the stream broke: {type(error).__name__}"
        if not accepted:
            yield Failed("assistant_unavailable", True, why)  # PF never had the question, so asking again is safe
            return
        yield await self._recover(conversation_id, accepted.agent_message_id, why)

    async def _stream(self, conversation_id: str, text: str):
        token = await self._login()
        body = {"conversation_id": conversation_id, "query": text}
        for attempt in (1, 2):
            url = f"{self.profile.base_url}{API}/addmessage/stream"
            async with self.client.stream("POST", url, json=body, headers=self._headers(token)) as reply:
                if reply.status_code == 401 and attempt == 1:
                    token = await self._login(stale=token)
                    continue
                if reply.status_code >= 300:
                    yield _failure(reply.status_code, "stream")
                    return
                async for line in reply.aiter_lines():
                    if line.startswith("data:") and (event := _event(line)):
                        yield event
                return

    async def _recover(self, conversation_id: str, message_id: str, why: str) -> Final | Failed:
        """PF finishes the answer anyway (pf-capability-sheet.md section 6), so fetch it until it is done."""
        deadline = time.monotonic() + self.recover_seconds
        while time.monotonic() < deadline:
            await asyncio.sleep(self.poll_seconds)
            try:
                reply = await self._call("GET", f"{API}/response/{conversation_id}/{message_id}")
                content = (reply.json().get("message_content") or [{}])[0] if reply.status_code == 200 else {}
            except (AgentError, ValueError, AttributeError):
                continue
            if content.get("status") == "COMPLETED":
                return Final(str(content["response"]), _usage(content))
            if content.get("status") == "FAILED":
                return Failed("assistant_unavailable", True, f"{why}; PF reports the answer failed")
        return Failed("assistant_unavailable", True, f"{why}; no answer within {self.recover_seconds:.0f} s")


async def check_profiles(profiles: dict[str, dict], names: list[str] | None = None) -> tuple[list[str], bool]:
    """Logs in with each connection profile: the control plane's "test connection" (M8-T4), and the check after a
    deployment. One line per profile, naming it and the outcome, never its address or credentials."""
    lines, connected = [], True
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(10, read=30)) as client:
        for name in names or list(profiles):
            if name not in profiles:
                lines.append(f"{name}: no such profile")
                connected = False
                continue
            try:
                await PfConnector(PfProfile(**profiles[name]), client).check()
                lines.append(f"{name}: connected")
            except AgentError as error:
                connected = False
                advice = "try again later" if error.retryable else "check the profile's credentials"
                lines.append(f"{name}: not connected, {advice} ({error.detail})")
    return lines, connected


if __name__ == "__main__":
    import os
    import sys

    if sys.argv[1:2] != ["check"]:
        sys.exit("usage: python -m ucp.pf check [profile ...]   (profiles from UCP_AGENT_PROFILES)")
    found, ok = asyncio.run(check_profiles(json.loads(os.environ.get("UCP_AGENT_PROFILES") or "{}"), sys.argv[2:]))
    print("\n".join(found) or "no profiles in UCP_AGENT_PROFILES")
    sys.exit(0 if ok and found else 1)
