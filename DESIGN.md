---
name: Conversation Plugin
description: A warm, polite chat widget that wears the customer's brand on someone else's page.
colors:
  warm-ground: "#fbf3ea"
  soft-border: "#e7dacb"
  ink: "#2b241f"
  secondary-ink: "#6f625a"
  paper-white: "#ffffff"
rounded:
  panel: "24px"
  full: "50%"
spacing:
  gap: "16px"
  edge: "24px"
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
---

# Design System: Conversation Plugin

## Overview

**Creative North Star: "The Polite Guest"**

The widget is a friendly consumer app sitting on someone else's page. It arrives as one small round button in the customer's colour and opens into a soft, warm-grounded panel that looks like an app the visitor already knows how to use. It does not dress up the host page or compete with it: the host's design comes first, the customer's colour comes second, and the world's own materials (a warm cream ground, a soft sand border, a deep warm ink) stay quiet underneath.

Depth is long, soft and low-contrast, tinted with the world's ink rather than grey. Motion is small and physical: a press that settles back with a slight overshoot, a panel that rises a short way and fades in without bouncing. Under reduced motion every movement goes and only the fade stays.

The world refuses the category default for chat widgets: no coloured header bar, no avatar, no two-tone bubbles. The customer's colour appears only on things that can be pressed.

**Key Characteristics:**
- Warm tinted ground, soft border and warm ink; never pure grey.
- The customer's brand colour fills only actionable elements.
- Generous, friendly corners: 24px panel, fully round launcher.
- Long, soft, ink-tinted shadows.
- A press spring on release, a short rise-and-fade on open, no entry bounce.
- Full screen on small windows; a floating panel anchored to the launcher's corner elsewhere.

## Colors

A warm, low-chroma neutral family built around one hue (around 55 to 70 degrees in OKLCH), with the customer's brand colour as the only accent.

### Primary
- **Customer Brand** (per-widget configuration, applied as the `--brand` custom property): not a fixed token of this world. Every customer sets its own; test pages use a labelled sample. It fills the launcher today and, in the chat, only actionable things (send, suggested questions). When the configuration has no valid six-digit hex colour, the launcher falls back to Warm Ink.
- **Icon ink on brand** (runtime choice of Paper White or pure black, whichever contrasts more with the brand colour): this is how no brand can make the launcher glyph unreadable. It is computed, never configured.

### Neutral
- **Warm Cream Ground** (warm-ground): the panel's surface, and the ground of the whole chat.
- **Soft Sand Border** (soft-border): the panel's 1px edge, and the resting track of the loading mark.
- **Warm Ink** (ink): the world's text colour; the outer band of the focus ring; the launcher fallback; the tint of every shadow (as `rgba(43,36,31,…)`).
- **Muted Umber** (secondary-ink): secondary ink; today the moving arc of the loading mark.
- **Paper White** (paper-white): the inner band of the focus ring and the light option for the launcher glyph. The contract names white cards for the chat; they are not built yet.

### Named Rules
**The Pressable Colour Rule.** The customer's brand colour appears only on things that can be pressed. Never on a header bar, a background, a border or a message surface.

**The Warm Neutral Rule.** Every neutral, including shadow tint, comes from the world's warm ink family. No cool or pure greys.

## Typography

Not built. The loader draws no text; its only words are the launcher's spoken name and the iframe title. The chat page (module M2) is not built yet, so no face, size or ramp is shipped and none is recorded as a token.

Declared but unbuilt guidance from the chosen world, to be confirmed by the first scan after M2 ships: a rounded humanist sans, self-hosted inside the chat. Plain, short, literal sentences. The stand-in page used in browser tests uses the system font and is not part of this system.

## Layout

The widget has two layouts, chosen by window size.

- **Floating (600px wide and 520px tall or larger):** the launcher sits 24px (edge) from the configured bottom corner, right by default or left by configuration, and never closer than the device safe-area inset on that side. The panel is 400 x 640, shrunk to `min(400px, 100vw - 48px)` by `min(640px, 100dvh - 120px)`, aligned to the same side and 16px (gap) above the launcher. The open launcher stays in place and becomes the close button.
- **Full screen (under 600px wide or under 520px tall):** the panel fills the viewport with no border and no radius, the launcher steps aside, and the host page's scroll is locked while it is open. The chat's own header carries the close control.
- **Inline (host-chosen target element):** the panel fills the target, at least 480px tall, with no launcher, no shadow and no motion.

Placement is direction-neutral: left and right are configuration, not assumptions.

## Elevation & Depth

The system is lifted, not flat: the launcher and the panel float above the host page on long, soft, low-contrast shadows tinted with Warm Ink. Each shadow pairs a long diffuse spread with a short contact shadow. The inline panel sits in the host's flow and carries no shadow.

### Shadow Vocabulary
- **Launcher rest** (`box-shadow: 0 10px 24px -10px rgba(43,36,31,.55), 0 2px 6px -2px rgba(43,36,31,.3)`): the closed launcher at rest.
- **Launcher hover** (`box-shadow: 0 14px 30px -10px rgba(43,36,31,.6), 0 3px 8px -2px rgba(43,36,31,.32)`): on pointer hover only, paired with a 2px lift.
- **Panel** (`box-shadow: 0 24px 60px -24px rgba(43,36,31,.45), 0 8px 20px -12px rgba(43,36,31,.25)`): the floating panel.

### Named Rules
**The Long Soft Shadow Rule.** Shadows are long, soft, negatively spread and ink-tinted. No hard edges, no offsets without blur, no neutral black.

## Shapes

Generous, friendly corners. The panel is gently rounded (24px) and clips its content; the launcher is a full circle (56px). A single 1px Soft Sand border defines the panel edge. In full-screen mode the panel drops both radius and border so it reads as the screen itself.

Declared but unbuilt (chat, M2): cards at 18px; inputs and chips fully round. Record them as tokens only once they render.

## Components

### Launcher
Small, round and out of the way; the customer's colour and nothing else.
- **Shape:** full circle (56px), with a 26px stroke glyph: a rounded chat bubble when closed, a cross when open. Glyphs are inline SVG, 2px round-capped strokes in `currentColor`.
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
- **Loading mark:** until the chat page loads, a quiet 28px ring is centred in the panel: a 3px Soft Sand track with a Muted Umber arc, turning once every 0.9s, linear. It spins only while the panel is open.
- **Reduced motion:** the rise, lift, press and spin are removed; only the 200ms fade stays.
- **Forced colours:** a 1px `CanvasText` border.

## Do's and Don'ts

### Do:
- **Do** keep the brand colour on pressable things only, and pick the glyph colour (white or black) by contrast at runtime.
- **Do** tint every shadow with Warm Ink (`rgba(43,36,31,…)`) and keep it long and soft.
- **Do** use the two-tone focus ring (3px white outline, 7px Warm Ink band) on anything the widget draws over the host page.
- **Do** open with a 12px rise and a 200ms fade on `cubic-bezier(.16,1,.3,1)`, and keep only the fade under reduced motion.
- **Do** spring only on release (`cubic-bezier(.34,1.56,.64,1)`), never on entry.
- **Do** go full screen under 600px wide or 520px tall, with no radius and no border.

### Don't:
- **Don't** use a coloured header bar, an avatar, or two-tone message bubbles.
- **Don't** fill backgrounds, borders or message surfaces with the brand colour.
- **Don't** use cool or pure greys for neutrals or shadows.
- **Don't** run any animation while the widget is closed.
- **Don't** bounce the panel on entry.
