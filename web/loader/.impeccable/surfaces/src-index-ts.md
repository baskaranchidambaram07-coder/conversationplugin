---
version: 1
slug: "src-index-ts"
primary_target: "src/index.ts"
related_targets: []
---

# Surface brief: the launcher and the panel frame (module M1)

Scope: the loader's launcher, greeting and panel frame on the customer's page. The chat inside the frame has its own brief (`web/widget`, `src/App.tsx`). Mode: Operate. Visitors: public visitors and signed-in residents equally, many on phones, many reading English as a second language. Task: find the launcher, open it, close it.

Constraints: at most 6 KB compressed, plain TypeScript, no framework, nothing stored on the visitor's device, no error ever reaching the host page. Nothing of ours but this one file loads on the customer's page, so the design language's values are written into its stylesheet string as plain colours.

Unresolved: none for the launcher itself.

## Direction contract

THESIS: The least of the PF design language (PFDL 2.3.0, its Cobalt theme) that a customer's page has to carry: a round launcher in the widget's colour, an optional greeting, and a frame in the chat's own ground. It refuses anything else of ours on the host page.

OWN-WORLD: Launcher: a 56px circle in the widget's colour (cobalt #0047ab without one), its glyph white or black by contrast, a soft shadow that deepens under the pointer. Greeting: a white card (#1a2537 in the dark), slate ink, a hairline, 12px corners with the one nearest the launcher pinched to 4px. Panel: 14px corners, the chat's ground (#ffffff, #121b2d in the dark), a hairline, the deepest shadow. Focus: 2px of white, then 2px of #1d4ed8, so it holds on any page.

STORY: The visitor notices a small round button, reads the greeting if there is one, opens the chat, and closes it with the same button.

FIRST VIEWPORT: Closed: the launcher 24px from the configured bottom corner, the greeting 12px above it. Open on a window 600px wide and 520px tall or more: a 400 by 640 panel 16px above the launcher, which becomes the close button. On a smaller window the panel fills the screen with no border or radius and the launcher steps aside.

Signature interaction and motion grammar: the launcher lifts 2px under the pointer and presses to 92%; the panel rises 12px and fades in over 180ms on cubic-bezier(.2,0,0,1), with no bounce; reduced motion keeps only the fade.

FORM: The organisation's own design language, pinned by the user in words on 20 November 2026 ("re-design the widget ui and console ui properly as per the new skill", then "do the interim re-skin"); the roll ran for the record and the pin beats it. seed:1f3f1633ecff7b9b

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
