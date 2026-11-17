---
version: 1
slug: "web-console"
primary_target: "web/console"
related_targets: []
---

# Admin console (web/console)

Mode: Operate. Audience: customer administrators (and our platform administrators) setting up a widget without an engineer, mostly once per widget, then returning to change the look or roll back. Job: get a widget from nothing to live on their site, inside the 60-minute promise, and keep it right afterwards. Constraints: WCAG 2.2 AA with full keyboard use; 360px to wide desktop; nothing secret shown after saving; the console cannot be framed; the chat's own component draws the preview; fonts self-hosted (font-src 'self').

## Direction contract

THESIS: The category standard, played straight at the craft of the Stripe Dashboard and Linear's settings: a calm professional admin in two schemes, light and graphite dark, chosen by the administrator. It refuses the old warm consumer look (cream ground, sand edges, rounded type, pill buttons) and any costume.

OWN-WORLD: Light: white cards on #f9fafb, ink #111827, secondary #6b7280, 1px #e5e7eb borders, one indigo accent #4f46e5. Dark (Graphite): ground #111315, panels #1b1e21, 1px seams #2a2e33 instead of shadows, text #e6e8ea, secondary #9aa1a9, accent #4f8cff. Inter with tabular figures; 8px-radius controls, 12px cards; state colours only for state (green live, amber unpublished, red problem). Destructive actions outline-only and set apart.

STORY: The administrator sees where each widget stands, does the one next thing, watches the chat change as they type, and reaches Go live knowing how many minutes it took.

FIRST VIEWPORT: Top bar: product name with "Console", tenant switcher, theme switch (System, Light, Dark), who is signed in. Widgets in a 280px column with name and state. Work area: widget name and its sites line, then a horizontal stepper of the six stations (numbered circles, checks when done, minutes under each, time left at its end), then the current station's card: the form at left, the live chat preview at 400px at right, primary action at the form's foot.

FORM: The category standard (canon, chosen by the user on the decision page), with the Graphite Console challenger as its dark scheme by the user's word. seed:3d9acdcfb3035329

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- A widget already live opens on its track at Go live, with its settings, install and versions one click from any station.
