---
version: 1
slug: "src-index-ts"
primary_target: "src/index.ts"
related_targets: []
---

# Surface brief: the widget (launcher, panel frame, and the chat inside it)

Scope: the loader's launcher and panel frame on the customer's page (M1), and the chat page inside the frame (M2), which inherits this world. Mode: Operate. Visitors: public visitors and signed-in residents equally, many on phones, many reading English as a second language. Task: find the launcher, open it, ask, read the answer, close it. The customer's title, brand colour and logo fill the world; one small "Powered by Purple Fabric" note sits inside the open chat.

Unresolved: whether the credit links anywhere; whether a customer may hide it.

## Direction contract

THESIS: A friendly consumer app the visitor already knows how to use, sitting politely on someone else's page: soft cards on a warm ground, plain words, and the customer's colour only where something can be pressed. It refuses the category default's coloured header bar, avatar and two-tone bubbles.

OWN-WORLD: Warm tinted ground (#fbf3ea), white cards, soft border (#e7dacb), ink (#2b241f), secondary ink (#6f625a). The brand colour fills only actionable things: the launcher, send, suggested questions. Corners: panel 24px, cards 18px, inputs and chips fully round. A rounded humanist sans, self-hosted in the chat; the loader draws no text. Shadows long, soft and low-contrast.

STORY: The visitor notices a small round button in the customer's colour, opens it, reads a plain welcome and the AI notice, taps a suggested question or types one, and reads the answer on a white card.

FIRST VIEWPORT: Closed: a 56px round launcher in the brand colour, 24px from the configured bottom corner, a chat glyph in whichever of white or black contrasts more. Open on screens 600px and wider: a 400 x 640 panel (shrunk to fit the window) on the warm ground with a 24px radius, 16px above the launcher, which becomes the close button. Under 600px the panel fills the screen with no radius, the launcher steps aside, and the chat's own header carries the close button.

Signature interaction and motion grammar: a soft spring when the launcher is pressed (it settles back with a slight overshoot); the panel rises 12px and fades in over 200ms, with no bounce on entry; reduced motion removes all movement and keeps only the fade.

FORM: Warm Consumer App, a dealt challenger rated competitive (not on my ordered list of seven), chosen by the user over the assigned Ticket Stub. seed:a841235b66c8bebb

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
