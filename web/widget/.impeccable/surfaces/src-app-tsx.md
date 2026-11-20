---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: the chat inside the panel (module M2)

Scope: the chat page served at /embed/{widgetId} inside the loader's panel, or filling the screen on phones, or inline in a host element. Mode: Operate. Visitors: public visitors and signed-in residents equally; many on phones, many reading English as a second language. Task: read the notice, ask (by typing or a suggested question), watch the answer arrive, act on it, close.

Constraints: 100 KB compressed first load for script and styles; Roboto self-hosted (no third-party font host); no text under 12px; everything sent to or shown in the browser built from the allow-listed message format (R13); the one "Powered by Purple Fabric" note at the foot. The `@purple-fabric/ui` package cannot be installed yet, so the design language's token values are written out at the top of `styles.css` and its components are not used.

Unresolved: whether the credit links anywhere and whether a customer may hide it; regenerating a finished answer (only a failed one can be retried); replacing the written-out tokens and the hand-built parts with `@purple-fabric/ui` and its AI elements once the package can be installed.

## Direction contract

THESIS: The familiar AI chat window, in the PF design language (PFDL 2.3.0, its Cobalt theme): the organisation's own system rather than a look of its own, so the assistant reads as a Purple Fabric product on any site. The widget's colour stands in for the language's primary. It refuses a second accent, gradients, glass, and a shadow on anything that does not float.

OWN-WORLD: White ground (#121b2d in the dark), slate ink #0f172a, muted #606f86, hairlines #e2e8f0, one neutral fill #f1f5f9. The primary (cobalt #0047ab, or the widget's colour) on send, the caret and the visitor's bubble, each with the ink that reads on it. Roboto, 16px at 1.6; 700 only for the welcome and page titles, 600 for headings and buttons. Corners 14, 12, 10 and 8px. A field's edge is #77879d; focus is a 2px gap, then 2px of #1d4ed8. Charts take the eight series colours in order.

STORY: The visitor sees who they are talking to, asks by typing or tapping a suggestion, watches the answer flow in beside the assistant's picture, copies it or stops it, and closes.

FIRST VIEWPORT: Header: the mark (picture, else logo, else initials) and the title at 17px, its actions at the end. An empty chat centres the 52px mark, the welcome as a page title (20px in the panel, up to 24px on a wide frame, 700) and the outlined suggestion chips. The composer, a 14px-cornered field with the send button in the primary colour, sits at the foot (at the middle on wide frames, suggestions under it), with the AI notice and the credit on one 12px line under it.

FORM: The organisation's own design language, pinned by the user in words on 20 November 2026 ("re-design the widget ui and console ui properly as per the new skill", then "do the interim re-skin"); the roll ran for the record and the pin beats it. seed:b39626668b40678d

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
