---
version: 1
slug: "web-console"
primary_target: "web/console"
related_targets: []
---

# Admin console (web/console)

Mode: Operate. Audience: customer administrators (and our platform administrators) setting up a widget without an engineer, mostly once per widget, then returning to change the look or roll back. Job: get a widget from nothing to live on their site, inside the 60-minute promise, and keep it right afterwards. Constraints: WCAG 2.2 AA with full keyboard use; 360px to wide desktop; nothing secret shown after saving; the console cannot be framed; the chat's own component draws the preview; fonts self-hosted (font-src 'self'). The `@purple-fabric/ui` package cannot be installed yet, so the design language's token values are written out at the top of `styles.css` and its components are not used.

## Direction contract

THESIS: A working admin in the PF design language (PFDL 2.3.0, its Cobalt theme), so the console reads as one of the organisation's own products: white cards on a slate canvas, one cobalt primary, flat surfaces. It refuses its earlier indigo and graphite look, a shadow under cards and controls, and any second accent.

OWN-WORLD: Canvas #f1f5f9, cards #ffffff, ink #0f172a, muted #606f86, hairlines #e2e8f0, field edges #77879d. Primary #0047ab under white text; its soft fill #e8f1fe marks the current widget, the chosen tile and a pressed toggle. Dark: canvas #070c1e, cards #121b2d, primary #3870be. Green #15803d, amber #c2410c and red #c81b3f mean state and nothing else. Roboto, 14px at 1.5 with tabular figures; the page title 20 to 24px at 700, card titles 17px at 500, buttons 600. Controls 8px, cards 12px. Shadows only under the account menu and the chat preview.

STORY: The administrator sees where each widget stands, does the one next thing, watches the chat change as they type, and reaches Go live knowing how many minutes it took.

FIRST VIEWPORT: Top bar: product name with "Console", tenant switcher, theme switch (System, Light, Dark), who is signed in. Widgets in a 280px column with name and state. Work area: widget name and its sites line, then a horizontal stepper of the six stations (numbered circles, checks when done, minutes under each, time left at its end), then the current station's card: the form at left, the live chat preview at 400px at right, primary action at the form's foot.

FORM: The organisation's own design language, pinned by the user in words on 20 November 2026 ("re-design the widget ui and console ui properly as per the new skill", then "do the interim re-skin"); the roll ran for the record and the pin beats it. seed:05c98d06db0a0382

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- A widget already live opens on its track at Go live, with its settings, install and versions one click from any station.
- Rebuild the console on `@purple-fabric/ui` (its app frame, fields and buttons) once the package can be installed; until then these are the console's own parts in the design language's colours, type and corners.
- The design language writes status words in lowercase ("live"); the console's state words stay capitalised because the same strings serve as headings and labels.
