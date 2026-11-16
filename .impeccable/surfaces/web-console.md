---
version: 1
slug: "web-console"
primary_target: "web/console"
related_targets: []
---

# Admin console (web/console)

Mode: Operate. Audience: customer administrators (and our platform administrators) setting up a widget without an engineer, mostly once per widget, then returning to change the look or roll back. Job: get a widget from nothing to live on their site, inside the 60-minute promise, and keep it right afterwards. Constraints: WCAG 2.2 AA with full keyboard use; 360px to wide desktop; nothing secret shown after saving; the console cannot be framed; the chat's own component draws the preview.

## Direction contract

THESIS: A widget is a journey to go-live, not a settings page. The surface refuses the category's tabbed settings form: each widget is a track of six stations (Agent, Sites, Sign-in, Look, Install, Go live) where only the next decision is open and the time left is always signed.

OWN-WORLD: The chat's warm world, calmer. Cream ground #fbf3ea, white cards with a 1px sand edge #e7dacb, warm ink #2b241f, muted umber #6f625a; the tinted widget column is the ground mixed with 35% sand. Nunito, modest sizes. Round pills for actions, warm-ink primary, outlined secondary. No brand colour except inside the preview.

STORY: The administrator sees where each widget stands, does the one next thing, watches the chat change as they type, and reaches Go live knowing how many minutes it took.

FIRST VIEWPORT: Top bar with the product mark, tenant switcher and who is signed in. Widgets down a 280px tinted column, each with its state line. The selected widget's name and purpose, then the six-station track spanning the main area with the minutes-left sign at its end. Below it, the current station's card: its form at left, the live preview at 400px at right; the primary action ends the form.

FORM: Onboarding track, position 3 of 7 on the ordered list (dealt lead). seed:84f7e6ca59cfe2d2. Signature move: every station signed with its minutes and the track signing the time left to go-live, raised from the airport wayfinding challenger.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- A widget already live opens on its track at Go live, with its settings, install and versions one click from any station.
