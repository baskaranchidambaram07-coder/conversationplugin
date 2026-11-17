---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: the chat inside the panel (module M2)

Scope: the chat page served at /embed/{widgetId} inside the loader's panel, or filling the screen on phones, or inline in a host element. Mode: Operate. Visitors: public visitors and signed-in residents equally; many on phones, many reading English as a second language. Task: read the notice, ask (by typing or a suggested question), watch the answer arrive, act on it, close.

Constraints: 100 KB compressed first load for script and styles; Inter self-hosted (no third-party font host); everything sent to or shown in the browser built from the allow-listed message format (R13); the one "Powered by Purple Fabric" note at the foot.

Unresolved: whether the credit links anywhere and whether a customer may hide it; regenerating a finished answer (only a failed one can be retried).

## Direction contract

THESIS: The familiar AI chat window, played straight with Claude's as the bar, wearing the customer's identity: their assistant's picture beside every answer and their colour on what can be pressed. It refuses answer cards, brand-filled suggestion pills, a coloured header bar and rounded playful type.

OWN-WORLD: Near-white ground #fcfcfb (charcoal #262624 in the dark), ink #1f1e1d, muted #6b6a68, hairlines #e6e4e0, the visitor's bubble #f0efeb, white surfaces for the composer and chips. Inter, 16px at 1.6. Answers as plain text beside a 28px round mark; outlined 12px-radius suggestion chips; a 20px-radius composer card with a 36px rounded-square send in the brand colour.

STORY: The visitor sees who they are talking to, asks by typing or tapping a suggestion, watches the answer flow in beside the assistant's picture, copies it or stops it, and closes.

FIRST VIEWPORT: Header: the mark (picture, else logo, else initials) and the title, its actions at the end. An empty chat centres the 52px mark, the welcome at 20px (26px on wide frames, where it leads a page) and the suggestion chips; the composer sits at the foot (on wide frames at the middle, suggestions under it), with the AI notice and the credit under it.

FORM: The category standard, the familiar AI chat window, chosen by the user in words (Claude as the bar); the roll ran for the record and the user's pin beats it. seed:bce0d129f501fad3

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
