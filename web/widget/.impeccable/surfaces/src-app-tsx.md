---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: the chat inside the panel (module M2)

Scope: the chat page served at /embed/{widgetId} inside the loader's panel, or filling the screen on phones, or inline in a host element. Mode: Operate. It inherits the world in DESIGN.md ("Warm Consumer App") and the composition of the decision sketch the user picked (.impeccable/mocks/decision/challenger-warm-app.html). Visitors: public visitors and signed-in residents equally; many on phones, many reading English as a second language. Task: read the notice, ask (by typing or a suggested question), watch the answer arrive, act on it, close.

Constraints: 100 KB compressed first load for script and styles; Nunito self-hosted (no third-party font host); everything sent to or shown in the browser built from the allow-listed message format (R13); the one "Powered by Purple Fabric" note at the foot.

Unresolved: whether the credit links anywhere and whether a customer may hide it; dark mode (the configuration's color_scheme is ignored in the base version).

## Direction contract

THESIS: The chat is the friendly app the visitor already knows: a calm warm page with answers on white cards, their own words in quiet sand bubbles, and the customer's colour only on what can be pressed (suggested questions, send). It refuses a coloured header bar, an avatar, and brand-coloured message bubbles.

OWN-WORLD: DESIGN.md's warm ground (#fbf3ea), white answer cards at 18px radius, visitor messages on Soft Sand (#e7dacb) at 18px, Warm Ink text (#2b241f) and Muted Umber secondary (#6f625a). Brand-filled pills for suggested questions and a round brand send button, their text and glyphs in white or black by contrast. Nunito, 16px body at 1.55, 20px semibold title. Ink-tinted long soft shadow only under the composer.

STORY: The visitor reads who they are talking to and that it is an AI assistant, taps a suggested question or types one, sees a working state within a moment, watches the answer arrive on a white card, can stop it, copy it or try again, and closes the chat from its own header.

FIRST VIEWPORT: Header: logo tile (40px, white, 12px radius; initials when no logo) beside the title, and at the end a group of 44px round icon buttons, 2px apart: New chat (plus; once there is a conversation to leave, narrow frames only), Your chats / Back to the chat (list glyph becoming a chevron mirrored in right-to-left; signed-in visitors on widgets with history on, narrow frames only), and Close (floating panel only, absent inline); under 340px, when all three would show, the header's New chat is hidden and stays in the list. From 720px with history on, the header spans a 288px Your chats column and the conversation. Below, the AI notice in Muted Umber. Then the welcome text and the suggested questions as brand pills, wrapping. The composer sits at the foot: a white rounded field that grows to five lines with the round send button inside it; under it, the credit. From 280px wide the same order holds with tighter padding.

Signature interaction and motion grammar: while waiting for the first word, three quiet dots breathe on an empty white card; words then land into the same card without layout jumps; the send button turns into a stop button in place. Reduced motion keeps the dots still.

FORM: Warm Consumer App, the world chosen by the user on the decision page, extended to the chat surface from the user-picked sketch; no new surface round. seed:a841235b66c8bebb

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
