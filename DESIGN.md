---
name: Conversation Plugin
description: A warm, polite chat widget that wears the customer's brand on someone else's page.
colors:
  warm-ground: "#fbf3ea"
  soft-border: "#e7dacb"
  ink: "#2b241f"
  secondary-ink: "#6f625a"
  paper-white: "#ffffff"
typography:
  title:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.3
  label-small:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
  meta:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  caption:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  credit:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
rounded:
  panel: "24px"
  card: "18px"
  tile: "12px"
  pill: "999px"
  full: "50%"
spacing:
  gap: "16px"
  edge: "24px"
  gutter: "16px"
  gutter-narrow: "10px"
  stack: "12px"
components:
  launcher:
    rounded: "{rounded.full}"
    size: "56px"
  launcher-unbranded:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
    size: "56px"
  panel:
    backgroundColor: "{colors.warm-ground}"
    rounded: "{rounded.panel}"
    width: "400px"
    height: "640px"
  logo-tile:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    size: "40px"
  answer-card:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  visitor-bubble:
    backgroundColor: "{colors.soft-border}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "10px 14px"
  suggestion-pill:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
    height: "44px"
  send-button:
    rounded: "{rounded.full}"
    size: "44px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label-small}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.soft-border}"
  button-quiet:
    textColor: "{colors.secondary-ink}"
    typography: "{typography.label-small}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
    height: "36px"
  button-quiet-hover:
    textColor: "{colors.ink}"
  composer:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.panel}"
    padding: "6px 6px 6px 18px"
---

# Design System: Conversation Plugin

## Overview

**Creative North Star: "The Polite Guest"**

The widget is a friendly consumer app sitting on someone else's page. It arrives as one small round button in the customer's colour and opens into a soft, warm-grounded panel that looks like an app the visitor already knows how to use. It does not dress up the host page or compete with it: the host's design comes first, the customer's colour comes second, and the world's own materials (a warm cream ground, a soft sand border, a deep warm ink) stay quiet underneath.

Inside, the chat is a calm warm page: answers on white cards, the visitor's own words in quiet sand bubbles, and the customer's colour only on suggested questions and the send button. Type is a rounded humanist sans, self-hosted, set in plain short sentences.

Depth is long, soft and low-contrast, tinted with the world's ink rather than grey. Motion is small and physical: a press that settles back with a slight overshoot, a panel that rises a short way and fades in without bouncing, three dots that breathe while an answer is on its way. Under reduced motion every movement goes; only the fade stays, and the dots hold still.

The world refuses the category default for chat widgets: no coloured header bar, no avatar, no brand-coloured message bubbles. The customer's colour appears only on things that can be pressed.

**Key Characteristics:**
- Warm tinted ground, soft border and warm ink; never pure grey.
- The customer's brand colour fills only actionable elements: the launcher, suggested questions, send and stop.
- Generous, friendly corners: 24px panel and composer, 18px cards and bubbles, fully round launcher, pills and send.
- Long, soft, ink-tinted shadows; surfaces inside the chat are separated by a 1px sand edge instead.
- A press spring on release, a short rise-and-fade on open, no entry bounce.
- Full screen on small windows; a floating panel anchored to the launcher's corner elsewhere.

## Colors

A warm, low-chroma neutral family built around one hue (around 55 to 70 degrees in OKLCH), with the customer's brand colour as the only accent.

### Primary
- **Customer Brand** (per-widget configuration, applied as the `--brand` custom property): not a fixed token of this world. Every customer sets its own; test pages use a labelled sample. It fills the launcher, the suggested-question pills and the send/stop button, and nothing else. When the configuration has no valid six-digit hex colour, the launcher and the chat fall back to Warm Ink.
- **Ink on brand** (`--on-brand`, a runtime choice of Paper White or pure black, whichever contrasts more with the brand colour): the colour of the launcher glyph, the pill text and the send glyph. This is how no brand can make them unreadable. It is computed, never configured.

### Neutral
- **Warm Cream Ground** (warm-ground): the panel's surface, and the ground of the whole chat.
- **Soft Sand Border** (soft-border): the panel's 1px edge; the 1px edge drawn around cards, the logo tile and the composer; the fill of the visitor's message bubbles and of a secondary action under the pointer; the thin scrollbar; text selection; the resting track of the loading mark.
- **Warm Ink** (ink): the world's text colour; the chat's focus outline and the composer's focus ring; the secondary action's outline; the outer band of the two-tone focus ring; the brand fallback; the tint of every shadow (as `rgba(43,36,31,…)`) and of hover washes on quiet controls (6 to 7%).
- **Muted Umber** (secondary-ink): secondary ink: the AI notice, meta lines, the placeholder, the character count, the credit, the quiet action, the working dots and the moving arc of the loading mark.
- **Paper White** (paper-white): answer and welcome cards, the composer, the logo tile, the secondary action at rest; the inner band of the two-tone focus ring and the light option for ink on brand.

### Named Rules
**The Pressable Colour Rule.** The customer's brand colour appears only on things that can be pressed. Never on a header bar, a background, a border or a message surface.

**The Warm Neutral Rule.** Every neutral, including shadow tint, comes from the world's warm ink family. No cool or pure greys.

## Typography

**Body Font:** Nunito Variable, self-hosted with the page (with Nunito, system-ui, sans-serif). No third-party font host.

**Character:** A rounded humanist sans used at modest sizes and weights; the chat reads as a familiar app, not a headline. Words are plain, short and literal, for readers with English as a second language. The loader itself draws no text; its only words are the launcher's spoken name and the iframe title.

### Hierarchy
- **Title** (600, 20px, 1.25): the widget title in the chat header. Wraps anywhere rather than overflowing.
- **Body** (400, 16px, 1.55): answer text, welcome text, visitor messages and the composer field (1.5 in the field).
- **Label** (650, 15px, 1.3): suggested-question pills.
- **Label small** (650, 14px): the secondary action, the quiet action and the jump-to-latest pill. The first line of a problem note uses 650 at body size.
- **Meta** (400, 14px): the AI notice, "You stopped this answer", the reference line, unrenderable parts of an answer.
- **Caption** (400, 13px): the character count, shown only near the limit.
- **Credit** (400, 12px): the one "Powered by Purple Fabric" line, centred at the foot.

The logo tile's fallback initials are 15px at 800 with 0.02em tracking; they are the only heavy weight in the chat.

### Named Rules
**The Pretty Wrap Rule.** Running text (the notice, cards and answer text) sets `text-wrap: pretty`, and anything user- or customer-supplied wraps anywhere rather than overflowing the panel.

## Layout

The widget has two layouts on the host page, chosen by window size.

- **Floating (600px wide and 520px tall or larger):** the launcher sits 24px (edge) from the configured bottom corner, right by default or left by configuration, and never closer than the device safe-area inset on that side. The panel is 400 x 640, shrunk to `min(400px, 100vw - 48px)` by `min(640px, 100dvh - 120px)`, aligned to the same side and 16px (gap) above the launcher. The open launcher stays in place and becomes the close button.
- **Full screen (under 600px wide or under 520px tall):** the panel fills the viewport with no border and no radius, the launcher steps aside, and the host page's scroll is locked while it is open. The chat's own header carries the close control.
- **Inline (host-chosen target element):** the panel fills the target, at least 480px tall, with no launcher, no shadow and no motion. The chat shows no close button.

Inside the panel the chat is one column, top to bottom: the header (logo tile, title, close), the scrolling conversation, the composer, then the credit. The side gutter is 16px, or 10px when the frame is under 340px wide, where visitor bubbles may also widen from 85% to 92%. The same order holds down to 280px wide. Items in the conversation stack 12px apart. The conversation fades out over its top 14px as it scrolls under the header (a CSS mask, not an overlay), and its scrollbar is thin, in Soft Sand. When the visitor scrolls up, a "Go to the latest message" pill appears centred above the composer.

Placement is direction-neutral: left and right are configuration, not assumptions, and the chat uses logical properties throughout so a right-to-left language mirrors.

## Elevation & Depth

The system is lifted, not flat: the launcher and the panel float above the host page on long, soft, low-contrast shadows tinted with Warm Ink. Each shadow pairs a long diffuse spread with a short contact shadow. The inline panel sits in the host's flow and carries no shadow. Inside the chat, cards and the logo tile are flat and separated from the ground by a 1px Soft Sand edge drawn as a box-shadow; only the composer and the jump-to-latest pill lift.

### Shadow Vocabulary
- **Launcher rest** (`box-shadow: 0 10px 24px -10px rgba(43,36,31,.55), 0 2px 6px -2px rgba(43,36,31,.3)`): the closed launcher at rest.
- **Launcher hover** (`box-shadow: 0 14px 30px -10px rgba(43,36,31,.6), 0 3px 8px -2px rgba(43,36,31,.32)`): on pointer hover only, paired with a 2px lift.
- **Panel** (`box-shadow: 0 24px 60px -24px rgba(43,36,31,.45), 0 8px 20px -12px rgba(43,36,31,.25)`): the floating panel.
- **Composer** (`box-shadow: 0 10px 24px -14px rgba(43,36,31,.4), 0 0 0 1px #e7dacb`): the composer at rest; the sand edge becomes a 2px Warm Ink ring while it holds focus.
- **Jump pill** (`box-shadow: 0 10px 24px -12px rgba(43,36,31,.45), 0 0 0 1px #e7dacb`): the "Go to the latest message" pill floating over the conversation.
- **Sand edge** (`box-shadow: 0 0 0 1px #e7dacb`): cards and the logo tile; keeps white distinct from the ground on a bright screen.

### Named Rules
**The Long Soft Shadow Rule.** Shadows are long, soft, negatively spread and ink-tinted. No hard edges, no offsets without blur, no neutral black.

## Shapes

Generous, friendly corners. The panel is gently rounded (24px) and clips its content; the launcher is a full circle (56px). A single 1px Soft Sand border defines the panel edge. In full-screen mode the panel drops both radius and border so it reads as the screen itself.

Inside the chat: the composer shares the panel's 24px; answer cards, the welcome card and visitor bubbles are 18px; the logo tile is 12px; pills and the secondary, quiet and jump actions are fully round (999px); send/stop and the close button are circles (44px). Glyphs are inline SVG on a 24 grid, 2px round-capped strokes in `currentColor`, drawn at 22px (18px inside small actions).

## Components

### Launcher
Small, round and out of the way; the customer's colour and nothing else.
- **Shape:** full circle (56px), with a 26px stroke glyph: a rounded chat bubble when closed, a cross when open.
- **Colour:** brand background; glyph in white or black, whichever contrasts more. Falls back to Warm Ink with a white glyph.
- **Hover (pointer devices only):** lifts 2px and deepens its shadow.
- **Press:** sinks to 92% scale over 80ms ease-out, then springs back on release with `cubic-bezier(.34,1.56,.64,1)` over 400ms (a slight overshoot).
- **Focus:** a two-tone ring that holds on any host page and any brand: a 3px white outline 2px off the button, wrapped in a 7px Warm Ink band.
- **Name:** icon-only, with a spoken name taken from the widget title (default "Chat").
- **Forced colours:** gains a 2px `ButtonText` border.

### Panel
A warm frame that holds the chat iframe.
- **Corner Style:** 24px, clipped; none when full screen.
- **Background:** Warm Cream Ground with a 1px Soft Sand border.
- **Shadow Strategy:** the Panel shadow (see Elevation & Depth).
- **Entry:** rises 12px and fades in over 200ms with `cubic-bezier(.16,1,.3,1)`; no bounce. Leaves the same way, then becomes hidden.
- **Loading mark:** until the chat page loads, a quiet 28px ring is centred in the panel: a 3px Soft Sand track with a Muted Umber arc, turning once every 0.9s, linear. It spins only while the panel is open. The chat page shows the same ring while its configuration loads.
- **Reduced motion:** the rise, lift, press and spin are removed; only the 200ms fade stays.
- **Forced colours:** a 1px `CanvasText` border.

### Chat header
Who the visitor is talking to, and a way out; no colour bar.
- **Logo tile:** 40px, Paper White, 12px radius, 1px Soft Sand edge; the customer's logo contained inside it, or the title's initials when there is no logo or it fails to load.
- **Title:** the Title style, beside the tile.
- **Close:** a 44px round icon button at the end, transparent, with a faint ink wash (7%) on hover. Shown only in the floating panel.

### Cards and bubbles
- **Answer and welcome cards:** Paper White, 18px, a 1px Soft Sand edge, 14px 16px padding, full width. Answers carry their actions inside the card.
- **Visitor bubbles:** Soft Sand fill, 18px, 10px 14px padding, aligned to the end, at most 85% wide.
- **Working state:** while an answer has no words yet, three 7px Muted Umber dots breathe on the empty card (opacity 0.25 to 1, 1.2s ease-in-out, staggered 0.15s). Under reduced motion they hold still at 60% opacity. Words then land in the same card.
- **Problem note:** a short plain sentence (its first line at 650), an optional reference line in Meta, and an optional secondary action.

### Buttons
- **Suggested-question pill (brand):** brand fill, `--on-brand` text in the Label style, fully round, at least 44px tall, 10px 16px padding; they wrap. Press: sinks to 96% over 80ms, springs back on the launcher's release curve.
- **Send / stop (brand):** a 44px circle inside the composer, brand fill, 22px glyph in `--on-brand`: an up arrow, which becomes a filled square stop while an answer arrives. Press: sinks to 92%, springs back on release. Disabled (nothing to send) at 35% opacity.
- **Secondary ("Try again", "Start a new chat"):** Paper White with a 1.5px Warm Ink outline, Label small, fully round, at least 36px tall, 8px 16px padding; fills with Soft Sand on hover.
- **Quiet ("Copy answer"):** text and an 18px glyph in Muted Umber, no fill, fully round, at least 36px; on hover a faint ink wash (6%) and Warm Ink text. Confirms with a check and "Copied" for 2 seconds.
- **Jump to latest:** Paper White pill with a down-arrow glyph, Label small, the Jump pill shadow.
- **Focus (everything inside the chat):** a 3px Warm Ink outline 2px off the element; the chat's ground is known, so one tone is enough.

### Composer
- **Style:** a Paper White field, 24px radius, the Composer shadow with its Soft Sand edge, 18px inline-start padding; the text field grows to 160px (about five lines) with the send button inside at the end.
- **Focus:** a 2px Warm Ink ring around the whole composer; the text field itself shows no outline.
- **Placeholder:** Muted Umber. Under it, the character count in Caption appears only in the last 400 of 4000 characters, and the credit sits below that.
- **Disabled:** when the chat session has ended, the field and send are disabled.

### Forced colours (chat)
The composer, cards, bubbles, pills and send each gain a 1px `CanvasText` border.

## Do's and Don'ts

### Do:
- **Do** keep the brand colour on pressable things only (launcher, suggested questions, send/stop), and pick the text and glyph colour on it (white or black) by contrast at runtime.
- **Do** tint every shadow with Warm Ink (`rgba(43,36,31,…)`) and keep it long and soft.
- **Do** use the two-tone focus ring (3px white outline, 7px Warm Ink band) on anything the widget draws over the host page, and the 3px Warm Ink outline 2px off inside the chat.
- **Do** put answers on Paper White cards with a 1px Soft Sand edge, and the visitor's words on Soft Sand bubbles, both at 18px.
- **Do** keep tap targets for pressable things at least 44px (36px for secondary and quiet actions inside a card).
- **Do** open with a 12px rise and a 200ms fade on `cubic-bezier(.16,1,.3,1)`, and keep only the fade under reduced motion.
- **Do** spring only on release (`cubic-bezier(.34,1.56,.64,1)`), never on entry.
- **Do** go full screen under 600px wide or 520px tall, with no radius and no border.
- **Do** self-host the chat's font.

### Don't:
- **Don't** use a coloured header bar, an avatar, or brand-coloured message bubbles.
- **Don't** fill backgrounds, borders or message surfaces with the brand colour; a brand outline is a border and is not allowed.
- **Don't** use cool or pure greys for neutrals or shadows.
- **Don't** run any animation while the widget is closed.
- **Don't** bounce the panel on entry.
