# Purple Fabric Capability Sheet

Status: first version, 12 November 2026. This is the output of plan task M0-T1. Checked against staging again on 13 November 2026 by `backend/tests/test_pf_staging.py`: every claim it tests still holds.

Everything below was observed against Purple Fabric (PF) staging with the capture script `spikes/pf_capture.py`, except section 9, which lists what still has to be asked. Staging runs in the US. Production runs in London and may differ in limits and timings. Addresses, identifiers and credentials are deliberately left out of this document.

## 1. Calls

| Purpose | Call | Result |
|---|---|---|
| Log in | `GET /accesstoken/<tenant>` with `apikey`, `username`, `password` headers | HTTP 200 with tokens, or HTTP 200 with a failure in the body |
| Create a conversation | `POST /magicplatform/v1/genai/conversation/create` | HTTP 201 with `conversation_details` |
| Send a message, streamed reply | `POST /magicplatform/v1/genai/conversation/addmessage/stream` | HTTP 201, server-sent events |
| Send a message, no stream | `POST /magicplatform/v1/genai/conversation/addmessage` | HTTP 201 at once, message marked in progress |
| Fetch a message and its answer | `GET /magicplatform/v1/genai/conversation/response/<conversation_id>/<message_id>` | HTTP 200 with the message record |

Every call after login carries the headers `apikey`, `X-Platform-Workspaceid` and `Authorization: Bearer <token>`.

## 2. Login and tokens

- Success returns `result: RESULT_SUCCESS`, an access token, a refresh token, `expires_in` of 28,800 seconds (8 hours) and `refresh_expires_in` of 3,888,000 seconds (45 days). Both durations arrive as text, not numbers.
- Failure also returns HTTP 200, with `result: RESULT_FAILURE`, a `message` and `active: false`. The status code cannot be used to detect a failed login.
- The access token is a signed token whose contents include the service user's name, tenant and roles. It is a secret and stays on the server.
- A second login leaves the first token valid. Several gateway instances can each log in on their own.
- Responses carry PF's own request ID in an `x-platform-request-id` header.

## 3. Creating a conversation

- The request body is the agent's version ID (`asset_version_id`) and a `conversation_name`.
- The reply's `conversation_details` holds the conversation ID, the name, a knowledge-base ID created for that conversation (`ondemand_kb_id`), the creating user, the workspace ID, a mode of `Live`, and a `deleted_at` field that starts empty.
- The conversation belongs to the service account. PF has no knowledge of our end users.
- PF keeps the conversation's context itself. The prompt size reported for each turn grows with the earlier turns.

## 4. The streamed reply

The reply is a stream of server-sent events. Each event is one `data:` line holding JSON, followed by a blank line. The order was the same in every run:

| # | Event | Content |
|---|---|---|
| 1 | no event name | A notice: "Stream connection established successfully" |
| 2 | no event name | A notice: "Agent Execution InProgress" |
| 3 | `MESSAGE_DETAILS`, status `SUCCESS` | The stored record of the user's message, including `message_id`, `message_content_id` and the workspace ID |
| 4 | `LLM_RESPONSE_STREAM`, status `START` | Empty |
| 5 | `LLM_RESPONSE_STREAM`, status `IN_PROGRESS`, repeated | A few characters of answer text in `content` |
| 6 | `LLM_RESPONSE_STREAM`, status `END` | Empty |
| 7 | `FINAL_RESPONSE`, status `SUCCESS` | The whole answer in `content.response`, plus token counts, cost, timings, sources, citations, generated files, and context-window usage |
| 8 | `STREAM_END`, status `SUCCESS` | Empty |

Points that matter for the connector:

- **The answer is Markdown text.** A Markdown table and a fenced `mermaid` block both came through unchanged.
- **Two different IDs share one field name.** `MESSAGE_DETAILS` gives the real `message_id` and a separate `message_content_id`. Events 4 to 8 carry a field called `message_id` that actually holds the content ID. Only the ID from `MESSAGE_DETAILS` works with the fetch call; the other returns HTTP 500.
- **Every event carries identifiers.** Events 3 to 8 carry the agent version ID and conversation ID, and event 3 carries the workspace ID. Event 7 carries cost and token counts. None of this may reach the browser.
- **Each word event is large.** About 220 bytes carry a few characters of text. The gateway re-sends them in a compact form.
- **Short answers arrive at once; long answers stream steadily.** See section 7.

## 5. Sending without a stream, and fetching the answer

- The non-streaming call returns immediately with the message record marked `IN_PROGRESS`.
- The fetch call returns the same record. Once the answer is ready, its `message_content` entry holds the `response` and a status of `COMPLETED`, with the same counts and cost as the stream's final event.
- Together they give a send-then-poll route, which serves as the fallback where streams are blocked.

## 6. When the caller hangs up

- The capture closed the connection at the first word of an answer. Twenty-five seconds later the fetch call returned the complete answer with status `COMPLETED`.
- The next message in the same conversation worked normally, and its prompt size showed that PF had kept the interrupted answer in the conversation's context.
- So a dropped connection loses nothing, and equally it cancels nothing. A stopped answer still uses PF capacity and is still remembered by the agent.

## 7. Limits and timings on staging

- **Rate limit:** 5,000 calls a minute, reported in `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset` headers on each response.
- **Context window reported:** 922,000 tokens. The model is from the Claude Sonnet family, one version behind the latest, by Intellect's standing preference.
- **First event:** 30 to 70 milliseconds after the request.
- **First word of the answer:** about 2 to 5 seconds.
- **Short answers arrive at once.** Where the model finished within a few seconds, all the word events arrived together at the end.
- **Long answers stream steadily.** With a second staging agent that answers at length, a 6,100-character answer arrived as 452 events over 23 seconds, and a 3,000-character answer as 207 events over 10 seconds. The pace was even, about 20 events a second, each carrying about 13 characters.
- **After the last word:** the end event followed after 0.5 to 1.3 seconds and the final event a quarter of a second later.

## 8. Error shapes

There are four, and only one of them uses the HTTP status in the normal way.

| Situation | HTTP status | Body |
|---|---|---|
| Wrong username or password at login | 200 | `{"result": "RESULT_FAILURE", "message": "...", "active": false}` |
| Missing or invalid token on any call | 401 | `{"message": "Not Authorized.", "error": "Unauthorized", "statusCode": 401}` |
| Unknown conversation, or empty message, on the stream call | 201 | The two notices, then an event `ERROR` with status `FAILED` and `content` holding `response`, `error_description` and the real `status_code` (404 or 400) |
| Fetch call with an ID it does not recognise | 500 | `{"message": "Unable to process the request. Please try again."}` |

## 9. What this means for the design

| Finding | Consequence | Where |
|---|---|---|
| A failed login and stream errors hide behind success statuses | The connector reads the body or the event, never the status alone | M6-T6 |
| Tokens last 8 hours; a second login does not cancel the first | Each gateway instance logs in and refreshes on its own. No shared token store, which supports running without Redis. | M6-T2, D11 |
| PF completes an answer after a hang-up, and the fetch call returns it | A dropped stream is recovered by fetching the answer. No resume logic is needed. | M4-T7, M6-T4 |
| Hanging up cancels nothing | The stop button stops the display only. The answer is still stored and marked as stopped, so our transcript matches what the agent remembers. | M4-T7, M2-T4 |
| Events carry identifiers, cost and counts | The allow-list forwards answer text only. Counts and cost go to usage metering. | D15, M13-T5 |
| The first word takes 2 to 5 seconds; long answers then stream at about 20 events a second | The chat shows a working state from PF's first notice, and redraws at most about 20 times a second while an answer streams. | M2-T5, M2-T6 |
| Send-then-poll exists | It is the fallback transport. | D2 |
| Answers are Markdown and fenced blocks survive | The fenced-block convention for charts and diagrams works without any change to PF. | D9 |
| The record has fields for file references, generated images and files, sources and citations | The message format reserves image, file and sources blocks. Attachments look feasible. | M0-T3, M10 |
| A failed login arrives with HTTP 200; whether PF locks the account after repeated failures is untested, on purpose | After a refusal, the connector waits five minutes before trying the same credentials again | M6-T2 |
| The model version moves on PF's schedule | Each stored message records the agent version. The nightly check against staging catches format changes. | M7-T5, M6 tests |

## 10. Questions for the PF team

A capture cannot answer these.

Answered on 12 November 2026:

- Conversations are not to be deleted for now.
- PF has no call to cancel a reply in progress.
- Short answers arrive at once; longer answers stream. Confirmed the same day with a second staging agent that answers at length (section 7).

Still open:

1. How is the refresh token used?
2. What is the production rate limit, and is it counted per API key?
3. What is the maximum message size, and how long can a conversation be resumed?
4. Does the agent version ID change when the agent is republished?
5. Can per-user context be passed to the agent?
6. How are files attached to a conversation message, and is there speech-to-text or text-to-speech for conversation agents?

## 11. Recorded samples

The raw streams and results are in `spikes/pf_capture_out/`, which is excluded from version control because the files contain staging identifiers. Cleaned copies, with every identifier replaced, are in `backend/fakepf/recordings/`, made by `spikes/clean_pf_recordings.py`. They are the test data for the fake PF and the connector tests. `backend/tests/test_pf_staging.py` compares their event order and fields with what staging sends, so a change in PF shows up as a failing test rather than as a fake that no longer matches.

The long answers are the main samples for the fake PF and the renderer tests. One of them contains headings, an eleven-row table, a code block and a diagram block, all of which came through unchanged.

The captures created six test conversations in the staging workspace. Their names start with `ucp-capture-` and `ucp-probe-`, and they can be deleted.
