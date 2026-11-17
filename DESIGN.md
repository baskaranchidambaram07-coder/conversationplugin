---
name: Conversation Plugin
description: The familiar AI chat window wearing the customer's identity, and the calm admin console that sets it up.
colors:
  chat-ground: "#fcfcfb"
  chat-surface: "#ffffff"
  chat-bubble: "#f0efeb"
  chat-line: "#e6e4e0"
  chat-ink: "#1f1e1d"
  chat-muted: "#6b6a68"
  chat-ground-dark: "#262624"
  chat-surface-dark: "#30302e"
  chat-bubble-dark: "#393936"
  chat-line-dark: "#3e3e3a"
  chat-ink-dark: "#f5f4ef"
  chat-muted-dark: "#b0aea5"
  chart-blue: "#2a78d6"
  chart-orange: "#eb6834"
  chart-aqua: "#1baf7a"
  chart-yellow: "#eda100"
  chart-magenta: "#e87ba4"
  chart-green: "#008300"
  chart-violet: "#6250d6"
  chart-red: "#e34948"
  console-ground: "#f9fafb"
  console-surface: "#ffffff"
  console-line: "#e5e7eb"
  console-ink: "#111827"
  console-muted: "#6b7280"
  console-accent: "#4f46e5"
  console-accent-hover: "#4338ca"
  console-accent-soft: "#eef2ff"
  console-problem: "#b42318"
  console-good: "#067647"
  console-good-soft: "#ecfdf3"
  console-warn: "#b54708"
  graphite-ground: "#111315"
  graphite-surface: "#1b1e21"
  graphite-field: "#15171a"
  graphite-line: "#2a2e33"
  graphite-ink: "#e6e8ea"
  graphite-muted: "#9aa1a9"
  graphite-accent: "#4f8cff"
  graphite-accent-hover: "#6b9dff"
  graphite-on-accent: "#0b1220"
  graphite-accent-text: "#8fb4ff"
  graphite-problem: "#f97066"
  graphite-good: "#47cd89"
  graphite-warn: "#fdb022"
typography:
  chat-body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "\"cv11\", \"ss01\""
  chat-title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  chat-welcome:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  chat-welcome-wide:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  answer-heading:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  answer-subheading:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  answer-minor-heading:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
  chat-label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.35
  chat-action:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  chat-caption:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "\"tnum\""
  code:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
  greeting:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  console-body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"cv11\", \"ss01\", \"tnum\""
  console-page-title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  console-card-title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  console-section-title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  console-label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  console-hint:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  console-small:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  console-group-label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.04em"
  console-snippet:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  inline: "6px"
  control: "8px"
  icon: "10px"
  card: "12px"
  greeting: "16px"
  panel: "20px"
  composer-wide: "24px"
  full: "50%"
  chip: "999px"
spacing:
  gutter: "16px"
  gutter-narrow: "10px"
  block: "10px"
  turn: "24px"
  form: "18px"
  edge: "24px"
  chats-column: "288px"
  conversation-column: "760px"
  console-column: "280px"
components:
  launcher:
    rounded: "{rounded.full}"
    size: "56px"
  panel:
    backgroundColor: "{colors.chat-ground}"
    rounded: "{rounded.panel}"
    width: "400px"
    height: "640px"
  greeting:
    backgroundColor: "{colors.chat-surface}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.greeting}"
    rounded: "{rounded.greeting}"
    padding: "12px 4px 12px 16px"
  chat-mark:
    backgroundColor: "{colors.chat-bubble}"
    textColor: "{colors.chat-ink}"
    rounded: "{rounded.full}"
    size: "28px"
  header-icon-button:
    textColor: "{colors.chat-muted}"
    rounded: "{rounded.icon}"
    size: "40px"
  visitor-bubble:
    backgroundColor: "{colors.chat-bubble}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.chat-body}"
    rounded: "{rounded.panel}"
    padding: "10px 16px"
  suggestion-chip:
    backgroundColor: "{colors.chat-surface}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.chat-label}"
    rounded: "{rounded.card}"
    padding: "8px 14px"
    height: "40px"
  composer:
    backgroundColor: "{colors.chat-surface}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.chat-body}"
    rounded: "{rounded.panel}"
    padding: "8px 8px 8px 16px"
  composer-wide:
    rounded: "{rounded.composer-wide}"
    padding: "10px 10px 10px 18px"
  send-button:
    rounded: "{rounded.icon}"
    size: "36px"
  button-quiet:
    textColor: "{colors.chat-muted}"
    typography: "{typography.chat-action}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
    height: "32px"
  button-quiet-hover:
    textColor: "{colors.chat-ink}"
  button-secondary:
    backgroundColor: "{colors.chat-surface}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.chat-action}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.chat-bubble}"
  code-panel:
    backgroundColor: "{colors.chat-ground}"
    textColor: "{colors.chat-ink}"
    typography: "{typography.code}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  code-inline:
    backgroundColor: "{colors.chat-ground}"
    rounded: "{rounded.inline}"
    padding: "1px 6px"
  table-frame:
    backgroundColor: "{colors.chat-surface}"
    typography: "{typography.table}"
    rounded: "{rounded.card}"
  table-header:
    backgroundColor: "{colors.chat-line}"
    textColor: "{colors.chat-ink}"
    padding: "8px 12px"
  chats-row:
    textColor: "{colors.chat-ink}"
    padding: "9px 14px"
    height: "56px"
  chats-row-current:
    backgroundColor: "{colors.chat-bubble}"
  console-primary:
    backgroundColor: "{colors.console-accent}"
    textColor: "{colors.console-surface}"
    typography: "{typography.console-label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "38px"
  console-primary-hover:
    backgroundColor: "{colors.console-accent-hover}"
  console-secondary:
    backgroundColor: "{colors.console-surface}"
    textColor: "{colors.console-ink}"
    typography: "{typography.console-label}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  console-secondary-hover:
    backgroundColor: "{colors.console-ground}"
  console-quiet:
    textColor: "{colors.console-muted}"
    typography: "{typography.console-label}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
    height: "36px"
  console-field:
    backgroundColor: "{colors.console-surface}"
    textColor: "{colors.console-ink}"
    typography: "{typography.console-body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "38px"
  console-card:
    backgroundColor: "{colors.console-surface}"
    rounded: "{rounded.card}"
    padding: "24px"
  console-choice:
    backgroundColor: "{colors.console-surface}"
    rounded: "{rounded.icon}"
    padding: "10px 12px"
  console-choice-chosen:
    backgroundColor: "{colors.console-accent-soft}"
  console-widget-row:
    rounded: "{rounded.control}"
    padding: "9px 10px"
  console-widget-row-current:
    backgroundColor: "{colors.console-accent-soft}"
  console-station-dot:
    backgroundColor: "{colors.console-surface}"
    textColor: "{colors.console-muted}"
    rounded: "{rounded.full}"
    size: "28px"
  console-station-dot-done:
    backgroundColor: "{colors.console-accent}"
    textColor: "{colors.console-surface}"
    rounded: "{rounded.full}"
    size: "28px"
  console-chip:
    backgroundColor: "{colors.console-good-soft}"
    textColor: "{colors.console-good}"
    rounded: "{rounded.chip}"
    padding: "1px 10px"
---

# Design System: Conversation Plugin

## Overview

**Creative North Star: "The Familiar Window, Their Face"**

Three surfaces share one record. The **chat** is the familiar AI chat window, played straight with Claude's as the bar: a near-white page (charcoal in the dark), answers set as plain text beside the assistant's round mark, the visitor's words in a soft grey bubble, a white composer card at the foot. It wears the customer's identity in two places only: their assistant's picture (or logo, or initials) beside every answer, and their colour on what can be pressed. It refuses answer cards, brand-filled suggestion pills, a coloured header bar and rounded playful type.

The **launcher and panel frame** sit on someone else's page and take the least room they can: a 56px circle in the brand colour or filled with the assistant's picture, an optional greeting bubble beside it, and a 20px-rounded panel in the chat's own ground that rises a short way and fades in. The **admin console** is the category-standard admin at the craft of the Stripe Dashboard and Linear's settings: white cards on cool grey with one indigo accent in Light, and Graphite in Dark (panels a step above a graphite ground, split by hairline seams instead of shadows, one blue accent). The administrator chooses System, Light or Dark; System follows the computer.

Everything is Inter, self-hosted, at modest sizes and weights; depth is hairlines first, shadow only where something floats.

**Key Characteristics:**
- Warm near-neutrals in the chat (#fcfcfb ground, #1f1e1d ink), cool greys in the console; neither carries an accent of its own except the console's one indigo or blue.
- The customer's colour on the launcher and the send button only, giving way to light ink on the dark composer when under 3:1.
- Answers are text, not cards; rich content (code, tables, diagrams, charts) sits in 12px hairline frames that scroll sideways inside themselves.
- Inter throughout, 16px at 1.6 in the chat and 14px at 1.55 with tabular figures in the console.
- Hairline rings (1px) do the separating; only the composer, the jump pill, the launcher, the greeting and the panel lift.
- Every colour has a light and a dark value; the chat picks by the widget's scheme, the console by the administrator's.
- Logical properties throughout, so a right-to-left language mirrors.

## Colors

Two neutral families and one accent each: warm near-neutrals with the customer's colour for the chat, cool greys with indigo (Light) or blue (Graphite) for the console.

### Primary
- **Customer Brand** (runtime `--brand`, no fixed value): set per widget as `#` and six digits; the launcher falls back to Chat Ink when it is not valid. Its glyph and the send glyph take white or black, whichever contrasts more (`inkOn`, computed, never configured).
- **Console Indigo** (console-accent) / **Graphite Blue** (graphite-accent): the console's one accent. Primary actions, done stations and the track's rail under them, focus outlines, the field's focus ring, radios and checkboxes, the loading arc. Its soft tint (console-accent-soft, or blue at 14% in Graphite) fills the current widget row, the chosen choice tile, pressed toggles, selected tabs and selection; text on that tint takes the deeper accent text (console-accent-hover, graphite-accent-text). In Graphite the accent carries dark text (graphite-on-accent).

### Tertiary (data and state)
- **Chart series** (chart-blue to chart-red, in that fixed order: blue, orange, aqua, yellow, magenta, green, violet, red): the validated categorical palette, each stepped for the dark card (`#3987e5`, `#d95926`, `#199e70`, `#c98500`, `#d55181`, `#008300`, `#9085e9`, `#e66767`). Data colours only; text never wears them.
- **Console state** (console-good, console-warn, console-problem, and their Graphite values): green for live and passing, amber for live-with-unpublished-changes and the colour warnings, red for problems and failing checks. Faults and failing checks sit on an 8% tint of the red over the surface; the shown-once secret on a 9% amber tint with a 30% amber hairline; the Live chip on console-good-soft.

### Neutral
- **Chat Ground** (chat-ground / chat-ground-dark): the page, the panel frame before the chat loads, code panels and inline code.
- **Chat Surface** (chat-surface / chat-surface-dark): the composer, suggestion chips, the secondary action, table, diagram and chart cards, the list of chats, the greeting bubble.
- **Bubble Grey** (chat-bubble / chat-bubble-dark): the visitor's bubble, blockquotes, the initials mark, the open chat's row, the secondary action's hover; mixed 45% into the ground for the wide chats column.
- **Hairline** (chat-line / chat-line-dark): every 1px edge and rule, the table's header fill, the loading sketch bars and the ring's track.
- **Chat Ink** (chat-ink / chat-ink-dark): text, links, the focus outline, hover washes (5 to 6%), the composer's focus ring (8%) and the brand fallback.
- **Muted** (chat-muted / chat-muted-dark): the AI notice, credit, placeholder, meta lines, quiet actions, header icons at rest, list markers, axis numbers, the working dots.
- **Console Ground, Surface, Line, Ink, Muted** and their Graphite counterparts take the same roles in the console. Graphite adds a separate field fill (graphite-field) a step below the panel.

### Named Rules
**The Pressable Colour Rule.** The customer's colour sits only on what can be pressed: the launcher and the send button. Elsewhere it appears only as a trace under the pointer (a suggestion chip's edge at 55% and fill at 5%) and as the caret. Never on a header, a bubble, a background or the mark.

**The 3:1 Rule.** On the dark composer (#30302e) a brand colour under 3:1 gives way to Chat Ink Dark, and the ink on it is recomputed (`forDark`). The console's colour notes use the same line: they warn when the colour is under 3:1 against the light composer (#ffffff) or the dark one, and state the text-on-colour ratio.

**The State-Only Rule.** In the console, green, amber and red mean state (live, unpublished, problem) and nothing else.

**The Light Sheet Rule.** A diagram keeps a white sheet in both schemes, because its source's colours assume a light page.

## Typography

**Body Font:** Inter Variable, self-hosted (with Inter, system-ui, sans-serif), features `cv11` and `ss01`; the console adds `tnum`.
**Mono Font:** the platform's own monospace (ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas), used only for code and the hex field. Nothing is downloaded for it.
**Greeting Font:** the host's system face (system-ui), because the greeting is drawn on the customer's page where Inter is not loaded.

**Character:** One neutral grotesque at modest sizes; hierarchy by weight before size, the familiar tools' register rather than a headline's.

### Hierarchy
- **Chat welcome** (600, 20px, 1.35, -0.015em, balanced, at most 28ch; 26px on wide frames): an empty chat's first line, centred under the 52px mark.
- **Chat title** (600, 16px, 1.3, -0.01em): the header; wraps anywhere.
- **Chat body** (400, 16px, 1.6): answers, the visitor's words, the composer (1.5 in the field).
- **Answer headings** (700, 1.3, balanced): h2 18px, h3 16px, h4 to h6 15px. A Markdown h1 renders as h2: the chat's title is the only h1.
- **Chat label** (400, 14px, 1.35): suggestion chips, meta and "unknown part" lines.
- **Chat action** (500, 13px): quiet and secondary actions; the code caption is 650 at 13px in Muted.
- **Chat caption** (400, 12px, 1.45, centred, balanced): the AI notice, the credit and the character count.
- **Table** (400, 14.5px, 1.45, tabular figures), header cells 700. **Code** (mono, 13.5px, 1.6, tabs at 2).
- **Console page title** (600, 24px, 1.25, -0.02em; 21px on phones). **Card title** (600, 17px). **Section title** (h3, 16px).
- **Console body** (400, 14px, 1.55). **Label** (500, 14px): field labels, legends, buttons. **Hint** (13px, Muted). **Small** (12.5px, Muted): state lines, minutes, table head cells. **Group label** (600, 12px, 0.04em, uppercase, Muted): the "Widgets" heading of the column only.

### Named Rules
**The Pretty Wrap Rule.** Running text sets `text-wrap: pretty` and anything the customer or visitor supplies wraps anywhere. Code never wraps and table cells wrap only between words; both scroll sideways inside their own frame.

## Layout

**Loader, chosen by window and host.**
- **Floating** (600px wide and 520px tall or more): the launcher 24px from the configured bottom corner (right by default, left by configuration), never inside the safe-area inset. The panel is `min(400px, 100vw - 48px)` by `min(640px, 100dvh - 120px)`, on the same side, 16px above the launcher; the open launcher becomes the close button. The greeting sits 12px above the closed launcher, at most 280px wide, and hides once the chat opens.
- **Full screen** (under 600px wide or 520px tall): the panel fills the viewport, no border, no radius; the launcher steps aside and the host page's scroll locks.
- **Expanded** (on the visitor's request, larger than a phone): the panel fills the window, no border or radius; closing returns to the panel.
- **Inline** (a host element): fills the target, at least 480px tall, no launcher, no shadow, no motion, no close button. From 720px of container width it drops border and radius.

**Chat.** One column: header (mark, title, actions), the scrolling conversation, then one foot landmark (composer, count, notice, credit). Gutter 16px, 10px under 340px wide, where the visitor's bubble may widen from 85% to 92% and the header's New chat hides when three actions would show. Turns stack 24px apart; rendered Markdown 10px; list items 4px with a 1.35em indent. The conversation fades over its top and bottom 14px (a mask, not an overlay). A "Go to the latest message" circle appears centred above the composer when the visitor scrolls up.
- **Wide frames (720px and wider):** the conversation, composer, notice and credit share one centred column of at most 760px; the visitor's bubble at most 75%. With history on, a 288px "Your chats" column runs the full height at the inline start on Bubble Grey 45% into the ground, its chats as 12px-rounded rows with no card. An empty chat holds the welcome above the middle, the composer at the middle, the suggestions centred under it.
- **Narrow frames:** "Your chats" swaps the list in for the conversation in the same scrolling region, with no motion.

**The Own Frame Rule.** Content wider than the column (code, tables, diagrams) scrolls sideways inside its own 12px frame, never the conversation. Each scroll region takes keyboard focus with its ring drawn inset. A soft shade shows at an inline edge only while more lies that way (a fixed radial of black at 22%, 12px, covered at each end by a 28px gradient of the frame's fill that scrolls with the content). Rows past the tenth fold behind "Show all N rows"; an expanded table scrolls vertically within `min(70vh, 560px)` with its header held.

**Console.** A top bar (at least 64px, 10px 28px, hairline under it), then a 280px widget column beside the work area (28px 40px 56px). The work area: page title, sites line, the six-station track with its sign at the end, then the station's card. On the four form stations the form sits beside the chat's live preview at 400px, 28px apart, the preview sticky 16px from the top. Forms stack 18px apart; field grids auto-fit columns of at least 240px. Under 1200px the preview stacks under the form and shows only on Look. Under 900px the column moves above the work, its widgets in a sideways-scrolling row of 200px tiles. Under 640px the bar becomes three rows, the track shows six dots with only the open station named, and facts fold to one column.

## Elevation & Depth

Hairlines first. Inside the chat and the console, surfaces separate from the ground by a 1px ring in the line colour (drawn as a box-shadow so it never shifts layout). Only what floats lifts: in the chat, the composer and the jump circle; on the host page, the launcher, the greeting and the panel; in the console, the chat preview. Chat and loader shadows mix from pure black so they read in both schemes. The console's Light theme adds a 1px whisper under controls and cards; Graphite has no shadow at all and relies on seams.

### Shadow Vocabulary
- **Composer** (`box-shadow: 0 8px 24px -16px rgb(0 0 0 / .4)`, plus `0 0 0 3px` ink at 8% on focus-within): the composer card.
- **Jump** (`box-shadow: 0 6px 16px -8px rgb(0 0 0 / .35)`): the "latest message" circle.
- **Launcher** (`0 10px 24px -10px rgba(0,0,0,.45), 0 2px 6px -2px rgba(0,0,0,.25)`; on hover `0 14px 30px -10px rgba(0,0,0,.5), 0 3px 8px -2px rgba(0,0,0,.28)` with a 2px lift).
- **Greeting** (`0 12px 32px -12px rgba(0,0,0,.35), 0 2px 6px -2px rgba(0,0,0,.12)`).
- **Panel** (`0 24px 60px -24px rgba(0,0,0,.4), 0 8px 20px -12px rgba(0,0,0,.2)`): the floating panel; the console preview uses the same at .35 and .2.
- **Console whisper** (`0 1px 2px rgb(16 24 40 / .05)`): Light theme primary, secondary, fields and cards; none in Graphite.

### Named Rules
**The Seam Rule.** Graphite separates panels by 1px seams, never shadows.

## Shapes

Soft, unshowy corners on a small scale. Chat: the panel, composer and visitor bubble 20px (the composer 24px on wide frames); suggestion chips, code, table, diagram and chart frames, blockquotes and the list of chats 12px; header icons, send and the chart tip 10px; quiet and secondary actions and the logo tile 8px; inline code and sketch bars 6px; the mark, launcher and jump circle round. The greeting is 16px with its corner nearest the launcher pinched to 4px (mirrored when the launcher is on the left). Console: controls 8px, cards 12px, choice tiles, snippets, faults, the add panel and the changes table 10px, the theme segment's buttons 6px, the swatch 4px, the Live chip fully round, station dots round. Glyphs are inline SVG on a 24 grid, 2px round strokes in `currentColor`.

## Components

### Launcher
- **Shape:** a 56px circle with a 26px chat-bubble glyph (a cross when open) in white or black by contrast. With an assistant's picture it fills the circle inside a 2px white inner ring; if the picture fails, the glyph returns.
- **Hover (pointer only):** lifts 2px, deeper shadow. **Press:** 92% over 80ms ease-out; returns on `cubic-bezier(.16,1,.3,1)` over 200ms.
- **Focus:** a two-tone ring that holds on any page and any brand: 3px white outline 2px off, wrapped in a 7px Chat Ink band. The greeting's buttons share it.
- **Forced colours:** a 2px `ButtonText` border.

### Greeting
A short line (at most 120 characters) beside the closed launcher: Chat Surface with a hairline, the line itself a button that opens the chat, and a 32px dismiss with a 16px cross in Muted. Rises 8px and fades over 400ms; still under reduced motion.

### Panel
20px, clipped, Chat Ground with a 1px hairline, the Panel shadow. Opens by rising 12px and fading over 200ms on `cubic-bezier(.16,1,.3,1)`. Until the chat loads, a 28px ring (3px hairline track, Muted arc, 0.9s linear) turns at its centre, only while open.

### Chat header and mark
- **Mark:** who answers. The assistant's picture, round; else the customer's logo contained on an 8px white tile with an inset hairline; else the title's initials (650, 38% of the size) on Bubble Grey. 32px in the header, 28px beside each answer, 52px over an empty chat.
- **Actions:** 40px icons, 10px radius, Muted, 20px glyphs, 2px apart; on hover a 6% ink wash and Chat Ink. New chat, Your chats / Back (mirrored chevron in right-to-left), Open / Exit full screen, Close, each only where it applies.

### Answers and the visitor's words
- **Answer:** text on the page beside the 28px mark, 12px apart: no card, no edge. Finished answers carry quiet actions underneath ("Copy answer").
- **Visitor bubble:** Bubble Grey, 20px, 10px 16px, at the end of the line.
- **Working:** three 7px Muted dots breathe (opacity .25 to 1, 1.2s, staggered .15s).
- **Problem:** a short sentence (its first line at 600), an optional Meta reference, an optional secondary action.

### Buttons
- **Send / stop:** a 36px rounded square (10px) at the composer's end, brand fill, an 18px glyph in the computed ink; an up arrow, a filled square while an answer arrives. Press 94% over 120ms. Disabled at 30% opacity.
- **Suggestion chip:** outlined, Chat Surface with a hairline, 12px, 8px 14px, at least 40px, Chat label, start-aligned, wrapping. Hover: edge brand 55% into the line, fill brand 5% into the surface.
- **Secondary:** Chat Surface, hairline, 8px, Chat action, at least 32px; Bubble Grey on hover.
- **Quiet:** Muted text and a 16px glyph, no fill, 8px; 6% ink wash and Chat Ink on hover. A copy says "Copied" only when it worked.
- **Focus (inside the chat):** a 3px Chat Ink outline 2px off.

### Composer
Chat Surface, 20px, a hairline and the Composer shadow; the field grows to 160px. Focus: the edge darkens to ink 40% into the line and gains a 3px ink 8% halo; the field itself shows no outline. The caret is the brand.

### Rendered answers
Links in Chat Ink, 1px underline 3px below, 2px on hover. Blockquote on Bubble Grey, 12px, 10px 14px, no side rule. Inline code mono 0.9em on Chat Ground with a hairline ring. Horizontal rule a hairline. Task items hang their 18px box where the bullet would be.
- **Code panel:** Chat Ground, hairline ring, 12px, clipped; a caption row (language in 650 13px Muted, quiet Copy) over a hairline; the body in Code, 12px 14px.
- **Table:** Chat Surface frame; header row filled with the hairline colour, 700, sticky; cells 8px 12px, at least 8ch, top-aligned, hairlines between rows and columns, no striping; a tools row (Copy as CSV, Show all) under a hairline.
- **Diagram:** a white sheet in both schemes; the source's own plain colours kept; tools to copy it or show its code.
- **Chart:** title 650 15px; legend Muted 13px, each name after its key (10px square, 14px stroke, or dot); series in the fixed palette; 1px hairline grid, the zero line at ink 30%, 12px Muted ticks in even figures; lines 2px round, areas a 10% wash, dots and slices ringed and gapped by the surface; a floating tip (surface, hairline, 10px) with values in ink 650 before their names. "Show as table" opens the numbers right-aligned.

### Your chats
One Chat Surface card, 12px, hairlines between rows (rows on the column's ground, 12px each, on wide frames). Rows at least 56px: the topic at 500 15px clamped to two lines over its time in 13px Muted. Hover 5% ink wash; the current row Bubble Grey, its time in ink. Loading: sketched hairline-colour bars breathing like the dots.

### Console: actions
- **Primary:** accent fill, 8px, 500 14px, at least 38px, 8px 16px, the whisper; accent-hover on hover. One per form, at its foot.
- **Secondary:** Surface with an inset hairline, at least 36px, 7px 14px; Ground on hover. Destructive actions are secondary and set apart below a hairline, confirmed by typing the name back.
- **Quiet:** Muted, no fill, 7px 10px, never wrapping; `--hover` wash and ink on hover.
- **Disabled:** 45% opacity. **Focus:** a 2px accent outline 2px off.

### Console: shell, track and cards
- **Top bar:** Surface. "Conversation Plugin" at 600 15px with its suffix in Muted 400; the organisation select (8px, hairline, chevron); the theme segment (three 32px icon buttons in an 8px inset-hairline group, pressed on accent-soft in accent text); who is signed in, in Muted; Sign out.
- **Widget column:** Surface with an inline-end hairline. Rows 8px, 9px 10px: title at 500 over a 12.5px state line (Muted; green when live, amber with unpublished changes). Hover the wash; current on accent-soft with its state in accent text.
- **Track:** six equal stations on a 2px rail through 28px dots, the rail accent under done stations. Dots: next Surface with a 1.5px line ring and the number in Muted 600 12.5px; done accent with a check in on-accent; now and open ringed `0 0 0 2px surface, 0 0 0 4px accent, 0 0 0 8px accent-ring`. Names 500 (600 when open), minutes under them in Small. Not-yet-reachable stations show a Muted name and a not-allowed cursor. The **sign** at the end, set off by a hairline: 600 13px in accent text, green once live.
- **Card:** Surface, 12px, hairline ring and whisper, 24px padding; header (card title and one Muted sentence) then parts 18px apart.
- **Preview:** the chat itself in an iframe, 20px, hairline, the Panel shadow, `min(560px, 70vh)` tall, captioned in 13px Muted with Light/Dark toggles when the scheme follows the device.

### Console: fields
Label (500 14px), optional hint, input 4px apart. Inputs on the field fill, 8px, hairline ring and whisper, at least 38px, 8px 12px, accent caret. Focus: `0 0 0 1px accent, 0 0 0 4px accent-ring` with a transparent outline for forced colours. Invalid: a 2px problem ring with the reason linked. Choice tiles: Surface, 10px, hairline, 10px 12px; chosen on accent-soft with a 1.5px accent ring, its muted text softened ink so it holds 4.5:1. The colour field: a 38px picker tile, a mono hex field, and polite notes (text-on ratio in green, 3:1 warnings in amber). Snippets: Ground, 10px, hairline, caption row over a hairline, mono 13px body at most 320px tall.

## Do's and Don'ts

### Do:
- **Do** keep the customer's colour on the launcher and send only, with white or black on it by contrast, and let it give way to light ink on the dark composer under 3:1.
- **Do** set answers as plain text beside the assistant's mark, and the visitor's words in a 20px Bubble Grey bubble.
- **Do** separate surfaces with 1px hairline rings; lift only what floats (composer, jump circle, launcher, greeting, panel, preview).
- **Do** give every chat colour a light and a dark value, and every console colour a Light and a Graphite value.
- **Do** let wide code, tables and diagrams scroll inside their own 12px frame with the edge shade, never widening the conversation.
- **Do** start an answer's headings at h2 (18px, 700); the chat's title is the only h1.
- **Do** go full screen under 600px wide or 520px tall, with no radius and no border.
- **Do** use the two-tone ring (3px white, 7px ink band) on anything drawn over the host page.
- **Do** keep the console's green, amber and red for state alone.
- **Do** stop every animation while the panel is closed, and under reduced motion remove the rise, lift, press, spin and greeting animation, keeping only the fade; the dots and sketch bars hold still at 60%.
- **Do** give every edge drawn as a box-shadow a 1px `CanvasText` border under forced colours, and mark the current chat's row with a 2px `Highlight` outline.
- **Do** use logical properties, and mirror directional glyphs in right-to-left.

### Don't:
- **Don't** put answers on cards, fill suggestion chips with the brand, or colour the chat's header.
- **Don't** put the customer's colour on a bubble, background, header, mark or border at rest.
- **Don't** use rounded playful type or pill buttons in the console; it is 8px controls and 12px cards.
- **Don't** add shadows in Graphite; seams separate its panels.
- **Don't** let text wear a chart's series colours; a series is named by its key.
- **Don't** stripe table rows.
- **Don't** bounce anything on entry.
