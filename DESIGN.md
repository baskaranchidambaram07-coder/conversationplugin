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
  answer-heading:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  answer-subheading:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  answer-minor-heading:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
  code-label:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 650
  table:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  table-header:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 700
    lineHeight: 1.45
    fontFeature: "tnum"
  list-heading:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  list-title:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.35
  code:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
  code-inline:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.9em"
rounded:
  panel: "24px"
  card: "18px"
  tile: "12px"
  inline: "6px"
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
  code-inline:
    backgroundColor: "{colors.warm-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.code-inline}"
    rounded: "{rounded.inline}"
    padding: "1px 6px"
  blockquote:
    backgroundColor: "{colors.warm-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "10px 14px"
  code-panel:
    backgroundColor: "{colors.warm-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.tile}"
    padding: "12px 14px"
  code-caption:
    textColor: "{colors.secondary-ink}"
    typography: "{typography.code-label}"
    padding: "4px 6px 4px 14px"
  table-frame:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    rounded: "{rounded.tile}"
  table-header:
    backgroundColor: "{colors.soft-border}"
    textColor: "{colors.ink}"
    typography: "{typography.table-header}"
    padding: "8px 12px"
  table-cell:
    typography: "{typography.table}"
    padding: "8px 12px"
  header-icon-button:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "44px"
  chat-list:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  chat-list-column:
    width: "288px"
  chat-row:
    textColor: "{colors.ink}"
    typography: "{typography.list-title}"
    padding: "10px 16px"
    height: "60px"
  chat-row-current:
    backgroundColor: "{colors.soft-border}"
    textColor: "{colors.ink}"
  chat-row-date:
    textColor: "{colors.secondary-ink}"
    typography: "{typography.meta}"
  chat-row-sketch:
    backgroundColor: "{colors.soft-border}"
    rounded: "{rounded.inline}"
    height: "12px"
---

# Design System: Conversation Plugin

## Overview

**Creative North Star: "The Polite Guest"**

The widget is a friendly consumer app sitting on someone else's page. It arrives as one small round button in the customer's colour and opens into a soft, warm-grounded panel that looks like an app the visitor already knows how to use. It does not dress up the host page or compete with it: the host's design comes first, the customer's colour comes second, and the world's own materials (a warm cream ground, a soft sand border, a deep warm ink) stay quiet underneath.

Inside, the chat is a calm warm page: answers on white cards, the visitor's own words in quiet sand bubbles, and the customer's colour only on suggested questions and the send button. Type is a rounded humanist sans, self-hosted, set in plain short sentences. Rich answers (headings, lists, code and tables) are made from the same materials: code sits on the cream ground, tables on paper, both framed by a sand edge, and anything too wide scrolls inside its own frame rather than stretching the conversation.

Depth is long, soft and low-contrast, tinted with the world's ink rather than grey. Motion is small and physical: a press that settles back with a slight overshoot, a panel that rises a short way and fades in without bouncing, three dots that breathe while an answer is on its way, and sketch rows that breathe the same way while the list of chats loads. Under reduced motion every movement goes; only the fade stays, and the dots and sketch rows hold still.

The world refuses the category default for chat widgets: no coloured header bar, no avatar, no brand-coloured message bubbles. The customer's colour appears only on things that can be pressed.

**Key Characteristics:**
- Warm tinted ground, soft border and warm ink; never pure grey.
- The customer's brand colour fills only actionable elements: the launcher, suggested questions, send and stop.
- Generous, friendly corners: 24px panel and composer, 18px cards and bubbles, fully round launcher, pills and send.
- Long, soft, ink-tinted shadows; surfaces inside the chat are separated by a 1px sand edge instead.
- A press spring on release, a short rise-and-fade on open, no entry bounce.
- Full screen on small windows; a floating panel anchored to the launcher's corner elsewhere.
- Code and tables in their own 12px frames that scroll sideways, with a soft ink cue at an edge only while more lies that way.
- Earlier chats as rows on one white, sand-edged card: in place of the conversation on narrow frames, a 288px column beside it from 720px.

## Colors

A warm, low-chroma neutral family built around one hue (around 55 to 70 degrees in OKLCH), with the customer's brand colour as the only accent.

### Primary
- **Customer Brand** (per-widget configuration, applied as the `--brand` custom property): not a fixed token of this world. Every customer sets its own; test pages use a labelled sample. It fills the launcher, the suggested-question pills and the send/stop button, and nothing else. When the configuration has no valid six-digit hex colour, the launcher and the chat fall back to Warm Ink.
- **Ink on brand** (`--on-brand`, a runtime choice of Paper White or pure black, whichever contrasts more with the brand colour): the colour of the launcher glyph, the pill text and the send glyph. This is how no brand can make them unreadable. It is computed, never configured.

### Neutral
- **Warm Cream Ground** (warm-ground): the panel's surface, and the ground of the whole chat. Inside an answer card it returns as the fill of code panels, blockquotes and inline code, so code reads as set into the page.
- **Soft Sand Border** (soft-border): the panel's 1px edge; the 1px edge drawn around cards, the logo tile, the composer, inline code, code panels and table frames; the fill of the visitor's message bubbles, of a table's header row and of a secondary action under the pointer; the rule under a code caption and above a table's tools; table row hairlines and vertical cell rules; the answer's horizontal rule; the conversation's thin scrollbar; text selection; the resting track of the loading mark. In the list of chats: the card's edge, the 1px hairlines between rows, the fill of the open chat's row, the bars of the loading sketch, and the chats column's 1px rule and thin scrollbar.
- **Warm Ink** (ink): the world's text colour, links in answers included; the chat's focus outline and the composer's focus ring; the secondary action's outline; the outer band of the two-tone focus ring; the brand fallback; the tint of every shadow (as `rgba(43,36,31,…)`), of the scroll-edge cue (22%) and of hover washes on quiet controls and chat rows (5 to 7%); the date on the open chat's row.
- **Muted Umber** (secondary-ink): secondary ink: the AI notice, meta lines (chat dates and the empty-list line among them), the placeholder, the character count, the credit, the quiet action, the working dots and the moving arc of the loading mark; in answers, list markers, the minor headings (h4 to h6) and the code panel's language label; at 60% (`rgba(111,98,90,.6)`) the scrollbar thumb of code panels and tables, dark enough to notice.
- **Paper White** (paper-white): answer and welcome cards, the list of chats, the composer, the logo tile, table frames, the secondary action at rest; the inner band of the two-tone focus ring and the light option for ink on brand.

### Named Rules
**The Pressable Colour Rule.** The customer's brand colour appears only on things that can be pressed. Never on a header bar, a background, a border or a message surface.

**The Warm Neutral Rule.** Every neutral, including shadow tint, comes from the world's warm ink family. No cool or pure greys.

## Typography

**Body Font:** Nunito Variable, self-hosted with the page (with Nunito, system-ui, sans-serif). No third-party font host.
**Mono Font:** the platform's own monospace (`--mono`: ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace), used only for code. Nothing is downloaded for it.

**Character:** A rounded humanist sans used at modest sizes and weights; the chat reads as a familiar app, not a headline. Words are plain, short and literal, for readers with English as a second language. The loader itself draws no text; its only words are the launcher's spoken name and the iframe title.

### Hierarchy
- **Title** (600, 20px, 1.25): the widget title in the chat header. Wraps anywhere rather than overflowing.
- **Body** (400, 16px, 1.55): answer text, welcome text, visitor messages and the composer field (1.5 in the field).
- **Label** (650, 15px, 1.3): suggested-question pills.
- **List heading** (700, 16px, 1.3): "Your chats", the heading of the list of chats.
- **List title** (650, 16px, 1.35): a chat's title in its row, clamped to two lines and wrapping anywhere.
- **Label small** (650, 14px): the secondary action, the quiet action and the jump-to-latest pill. The first line of a problem note uses 650 at body size.
- **Meta** (400, 14px): the AI notice, "You stopped this answer", the reference line, unrenderable parts of an answer; a chat's date in its row ("9:05", "Yesterday", a weekday, "2 Nov") and the empty-list line "Chats you start will appear here."
- **Caption** (400, 13px): the character count, shown only near the limit.
- **Credit** (400, 12px): the one "Powered by Purple Fabric" line, centred at the foot.

The logo tile's fallback initials are 15px at 800 with 0.02em tracking; they are the only heavy weight in the chat.

### Answer hierarchy
The chat's title is the page's only h1, so headings in an answer are shifted down one level: a Markdown h1 renders as h2, h2 as h3, and so on, with h5 and h6 both rendering as h6. An answer never carries an h1. Headings share weight 700 and line-height 1.3, set `text-wrap: balance`, and stand 6px further from what precedes them (not at the top of an answer).
- **Answer heading** (700, 18px, 1.3): an answer's h2; the one size step above body inside an answer.
- **Answer subheading** (700, 16px, 1.3): h3. A step by weight alone, deliberately below the h2 and at body size.
- **Answer minor heading** (700, 15px, 1.3, Muted Umber): h4 to h6.
- **Code label** (650, 13px): the language label in a code panel's caption, in Muted Umber, on one line, cut with an ellipsis when tight.
- **Code** (400, 13.5px, 1.6, mono): the code panel body, tabs at 2 spaces.
- **Inline code** (mono at 0.9em of the surrounding text).
- **Table** (400, 14.5px, 1.45, tabular figures): table cells; header cells at 700 and kept on one line.

### Named Rules
**The Pretty Wrap Rule.** Running text (the notice, cards and answer text) sets `text-wrap: pretty`, and anything user- or customer-supplied wraps anywhere rather than overflowing the panel. Code and tables are the exception: code never wraps and table cells wrap only between words (header cells not at all); both scroll sideways inside their own frame instead.

## Layout

The widget has two layouts on the host page, chosen by window size.

- **Floating (600px wide and 520px tall or larger):** the launcher sits 24px (edge) from the configured bottom corner, right by default or left by configuration, and never closer than the device safe-area inset on that side. The panel is 400 x 640, shrunk to `min(400px, 100vw - 48px)` by `min(640px, 100dvh - 120px)`, aligned to the same side and 16px (gap) above the launcher. The open launcher stays in place and becomes the close button.
- **Full screen (under 600px wide or under 520px tall):** the panel fills the viewport with no border and no radius, the launcher steps aside, and the host page's scroll is locked while it is open. The chat's own header carries the close control.
- **Inline (host-chosen target element):** the panel fills the target, at least 480px tall, with no launcher, no shadow and no motion. The chat shows no close button.

Inside the panel the chat is one column, top to bottom: the header (logo tile, title, then its actions: New chat, Your chats and close, each only where it applies), the scrolling conversation, the composer, then the credit. The side gutter is 16px, or 10px when the frame is under 340px wide, where visitor bubbles may also widen from 85% to 92%. The same order holds down to 280px wide. Items in the conversation stack 12px apart. The conversation fades out over its top and bottom 14px as it scrolls under the header and into the composer (a CSS mask, not an overlay), and its scrollbar is thin, in Soft Sand. When the visitor scrolls up, a "Go to the latest message" pill appears centred above the composer.

**Earlier chats.** On widgets with history on, signed-in visitors see their earlier chats.
- **Narrow frames (under 720px):** "Your chats" in the header swaps the list in for the conversation and the composer, inside the same scrolling region, with 10px top padding so the 14px top fade clears the list. The credit stays. Opening and closing the list is an immediate swap, with no motion.
- **Wide frames (720px and wider):** the chat becomes a grid. The header spans the top; a 288px "Your chats" column stands at the inline start with its own thin Soft Sand scrollbar and a 1px Soft Sand rule at its inline end; the conversation and the composer keep a measure of at most 760px, centred in the rest.
- **A reopened chat:** a quiet "Show earlier messages", centred above the first turn, loads older messages above without moving the view.

Inside an answer card, rendered Markdown stacks its blocks 10px apart; list items sit 4px apart with a 1.35em inline-start indent. Code panels and table frames stretch to the card's full width and never widen it.

**The Own Frame Rule.** Content wider than the card (code, tables) scrolls sideways inside its own frame, never the card or the conversation. Each scroll region is reachable by keyboard and named for assistive technology. A table scrolls vertically only after the visitor has expanded it, and then within `min(70vh, 560px)`, so a short table never traps a thumb inside the conversation.

Placement is direction-neutral: left and right are configuration, not assumptions, and the chat uses logical properties throughout so a right-to-left language mirrors.

## Elevation & Depth

The system is lifted, not flat: the launcher and the panel float above the host page on long, soft, low-contrast shadows tinted with Warm Ink. Each shadow pairs a long diffuse spread with a short contact shadow. The inline panel sits in the host's flow and carries no shadow. Inside the chat, cards and the logo tile are flat and separated from the ground by a 1px Soft Sand edge drawn as a box-shadow; only the composer and the jump-to-latest pill lift.

### Shadow Vocabulary
- **Launcher rest** (`box-shadow: 0 10px 24px -10px rgba(43,36,31,.55), 0 2px 6px -2px rgba(43,36,31,.3)`): the closed launcher at rest.
- **Launcher hover** (`box-shadow: 0 14px 30px -10px rgba(43,36,31,.6), 0 3px 8px -2px rgba(43,36,31,.32)`): on pointer hover only, paired with a 2px lift.
- **Panel** (`box-shadow: 0 24px 60px -24px rgba(43,36,31,.45), 0 8px 20px -12px rgba(43,36,31,.25)`): the floating panel.
- **Composer** (`box-shadow: 0 10px 24px -14px rgba(43,36,31,.4), 0 0 0 1px #e7dacb`): the composer at rest; the sand edge becomes a 2px Warm Ink ring while it holds focus.
- **Jump pill** (`box-shadow: 0 10px 24px -12px rgba(43,36,31,.45), 0 0 0 1px #e7dacb`): the "Go to the latest message" pill floating over the conversation.
- **Sand edge** (`box-shadow: 0 0 0 1px #e7dacb`): cards, the list of chats, the logo tile, inline code, code panels and table frames; keeps white distinct from the ground on a bright screen, and frames rich content inside a card without lifting it.
- **Scroll-edge cue** (`radial-gradient(farthest-side at 0 50%, rgba(43,36,31,.22), transparent)`, 12px wide, mirrored at the other inline edge): inside a sideways-scrolling code panel or table, a soft ink shade at an inline edge only while more content lies that way. It is a fixed background covered at each end by a 28px gradient of the frame's own fill that scrolls with the content, so it disappears once the visitor reaches that end. It is a cue, not elevation.

### Named Rules
**The Long Soft Shadow Rule.** Shadows are long, soft, negatively spread and ink-tinted. No hard edges, no offsets without blur, no neutral black.

## Shapes

Generous, friendly corners. The panel is gently rounded (24px) and clips its content; the launcher is a full circle (56px). A single 1px Soft Sand border defines the panel edge. In full-screen mode the panel drops both radius and border so it reads as the screen itself.

Inside the chat: the composer shares the panel's 24px; answer cards, the welcome card and visitor bubbles are 18px; the list of chats is one 18px card that clips its rows; the logo tile, code panels, table frames and blockquotes are 12px (code panels and table frames clip their content to it); inline code and the bars of the list's loading sketch are 6px; pills and the secondary, quiet and jump actions are fully round (999px); send/stop and the header's icon buttons are circles (44px). Glyphs are inline SVG on a 24 grid, 2px round-capped strokes in `currentColor`, drawn at 22px (18px inside small actions).

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
- **Actions:** a group of 44px round icon buttons at the end, 2px apart, transparent, each with a faint ink wash (7%) on hover. In order:
  - **New chat:** a plus glyph, shown once there is a conversation to leave, on narrow frames only.
  - **Your chats / Back to the chat:** a list glyph that becomes a chevron (mirrored in right-to-left). Shown only to signed-in visitors on widgets with history on, on narrow frames only; the two states share one place beside Close.
  - **Close:** shown only in the floating panel.
- **Under 340px:** when all three would show, the header's New chat is hidden so the title keeps its room; New chat stays in the list.

### Cards and bubbles
- **Answer and welcome cards:** Paper White, 18px, a 1px Soft Sand edge, 14px 16px padding, full width. Answers carry their actions inside the card.
- **Visitor bubbles:** Soft Sand fill, 18px, 10px 14px padding, aligned to the end, at most 85% wide.
- **Working state:** while an answer has no words yet, three 7px Muted Umber dots breathe on the empty card (opacity 0.25 to 1, 1.2s ease-in-out, staggered 0.15s). Under reduced motion they hold still at 60% opacity. Words then land in the same card.
- **Problem note:** a short plain sentence (its first line at 650), an optional reference line in Meta, and an optional secondary action.

### Your chats
The visitor's earlier chats, on paper, ruled in sand.
- **Heading row:** "Your chats" in the List heading style, with the secondary "New chat" (an 18px plus glyph) on the same row; it wraps when tight.
- **List:** one Paper White card, 18px radius, the Sand edge, a 1px Soft Sand hairline between rows.
- **Row:** a full-width button, at least 60px tall, 10px 16px padding: the title in the List title style above its date in Meta (Muted Umber).
- **Hover:** a faint ink wash (5%).
- **Open chat** (the current row): Soft Sand fill, its date in Warm Ink, because Muted Umber on Soft Sand is 4.2:1, short of AA for small text.
- **Focus:** the chat's 3px Warm Ink outline drawn inset (offset -3px), since the card clips its rows.
- **Loading:** three sketched rows of Soft Sand bars (72% and 32% wide, 12px tall, 6px radius), breathing like the working dots; under reduced motion they hold still at 60%.
- **Empty:** a single Meta line, "Chats you start will appear here."
- **More:** a quiet "Show older chats", centred under the list.

### Buttons
- **Suggested-question pill (brand):** brand fill, `--on-brand` text in the Label style, fully round, at least 44px tall, 10px 16px padding; they wrap. Press: sinks to 96% over 80ms, springs back on the launcher's release curve.
- **Send / stop (brand):** a 44px circle inside the composer, brand fill, 22px glyph in `--on-brand`: an up arrow, which becomes a filled square stop while an answer arrives. Press: sinks to 92%, springs back on release. Disabled (nothing to send) at 35% opacity.
- **Secondary ("Try again", "Start a new chat", the list's "New chat"):** Paper White with a 1.5px Warm Ink outline, Label small, fully round, at least 36px tall, 8px 16px padding; fills with Soft Sand on hover.
- **Quiet ("Copy answer", "Copy code", "Copy as CSV", "Copy for draw.io", "Show code", "Show all N rows", "Show older chats", "Show earlier messages"):** text and an 18px glyph in Muted Umber, no fill, fully round, at least 36px; inside code and table frames the label never wraps. On hover a faint ink wash (6%) and Warm Ink text. A copy action says "Copied" with a check for 2 seconds only when the copy worked, and "Could not copy" (keeping the copy glyph) when the browser refuses.
- **Jump to latest:** Paper White pill with a down-arrow glyph, Label small, the Jump pill shadow.
- **Focus (everything inside the chat):** a 3px Warm Ink outline 2px off the element; the chat's ground is known, so one tone is enough.

### Rendered answers
An answer's words are Markdown drawn in the world's own materials, inside the answer card.
- **Lists:** native bullets and numbers with Muted Umber markers.
- **Links:** Warm Ink with a 1px underline 3px below the text, thickening to 2px on hover; they open in a new tab. An image is never fetched: it becomes a link reading "Image: [description]".
- **Blockquote:** Warm Cream Ground, 12px radius, 10px 14px padding, no rule at the side.
- **Inline code:** mono at 0.9em on Warm Cream Ground with a 1px Soft Sand ring, 6px radius, 1px 6px padding.
- **Horizontal rule:** a 1px Soft Sand line across the card.

### Code panel
Code set into the page, labelled and copyable, never interpreted.
- **Frame:** Warm Cream Ground, 1px Soft Sand edge, 12px radius, full card width, clipped.
- **Caption row:** the language label in the Code label style ("Code" when none is given, "Diagram source" for mermaid) and a quiet "Copy code" action at the end, over a 1px Soft Sand rule; 4px 6px padding, 14px at the start.
- **Body:** the Code style, 12px 14px padding; long lines scroll sideways with the scroll-edge cue and a thin Muted Umber (60%) scrollbar.
- **Highlighting:** none in the base version; code is one colour, Warm Ink.

### Table
Data on paper, ruled in sand.
- **Frame:** Paper White, 1px Soft Sand edge, 12px radius, full card width, clipped.
- **Header row:** Soft Sand fill, bold, start-aligned, 8px 12px padding, held in place (sticky) while the table scrolls.
- **Cells:** the Table style with tabular figures, 8px 12px padding, top-aligned, at least 8ch wide; a 1px Soft Sand hairline between rows and a 1px Soft Sand rule between columns. No zebra striping.
- **Width:** cells wrap between words; a table too wide for that scrolls sideways with the scroll-edge cue and a thin Muted Umber (60%) scrollbar.
- **Length:** rows past the tenth fold away behind a quiet "Show all N rows" action. Once expanded, the table scrolls vertically within `min(70vh, 560px)`.
- **Tools row:** under a 1px Soft Sand rule, a quiet "Copy as CSV" and the show-all action; it wraps when narrow.
- **Open:** the sticky header row shows no edge cue, because its solid Soft Sand fill covers the shade beneath it.

### Diagram
A draw.io or Excalidraw diagram in an answer, drawn rather than shown as code; data on paper, like a table.
- **Frame:** Paper White, 1px Soft Sand edge, 12px radius, full card width, clipped. The drawing scrolls sideways inside it with the scroll-edge cue and a thin Muted Umber (60%) scrollbar.
- **Size:** as wide as the frame and never larger than drawn, but never so small that the diagram's usual label falls under 10px; past that the frame scrolls. On a 960px frame a typical diagram shows whole; in the 400px panel it scrolls.
- **Drawing:** the diagram's own fills, strokes and dashes, kept only when they are plain colours (`#rgb`, `#rrggbb` or a colour name). Where it sets none, boxes are Paper White with a Warm Ink stroke and words are Warm Ink, in the chat's Nunito. A line's label sits on a Paper White patch. Nothing is fetched, linked or run.
- **Tools row:** under a 1px Soft Sand rule, a quiet "Copy for draw.io" (or "Copy for Excalidraw") and "Show code" with a code glyph, which shows the source under the drawing on the cream ground, as a code panel's body; it wraps when narrow.
- **Spoken:** the drawing is an image named with its counts ("Diagram: 6 shapes and 7 lines") and described by every label and every line's ends and label.
- **While arriving, or unreadable:** the code panel, until the diagram is complete and readable.

### Scroll regions
Code bodies and table scroll areas take keyboard focus. Their focus ring is the chat's 3px Warm Ink outline drawn inset (offset -3px), so the frame's clipping never hides it.

### Composer
- **Style:** a Paper White field, 24px radius, the Composer shadow with its Soft Sand edge, 18px inline-start padding; the text field grows to 160px (about five lines) with the send button inside at the end.
- **Focus:** a 2px Warm Ink ring around the whole composer; the text field itself shows no outline.
- **Placeholder:** Muted Umber. Under it, the character count in Caption appears only in the last 400 of 4000 characters, and the credit sits below that.
- **Disabled:** when the chat session has ended, the field and send are disabled.

### Forced colours (chat)
The composer, cards, bubbles, pills, send, code panels, table frames and the list of chats each gain a 1px `CanvasText` border, since their sand edge is a box-shadow that this mode removes. The open chat's row gains a 2px `Highlight` outline drawn inset, since its Soft Sand fill goes too.

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
- **Do** let wide code and tables scroll sideways inside their own 12px frame, with the soft ink edge cue, never widening the card or the conversation.
- **Do** start an answer's headings at h2 (18px, 700); the chat's title is the only h1.

### Don't:
- **Don't** use a coloured header bar, an avatar, or brand-coloured message bubbles.
- **Don't** fill backgrounds, borders or message surfaces with the brand colour; a brand outline is a border and is not allowed.
- **Don't** use cool or pure greys for neutrals or shadows.
- **Don't** run any animation while the widget is closed.
- **Don't** bounce the panel on entry.
- **Don't** stripe table rows; rows are separated by Soft Sand hairlines.
