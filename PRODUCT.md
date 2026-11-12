# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Visitors to a customer's website**, who open the chat to ask a question. For the first customer, Goodenough College in London, there are two kinds, and they matter equally:
  - public visitors: prospective residents and their families, finding out about the College;
  - signed-in residents: international postgraduate students and their families, from about 80 countries. Many use phones, and many read English as a second language.
- **Customer administrators**, who set up a widget (title, colour, logo, the agent, allowed sites) without engineering help.

## Product Purpose

An assistant any website adds with one script tag, answering from the customer's own Purple Fabric agent. The customer gets a working, branded chat in under an hour without building a chat interface or running a backend. Success: a visitor gets a useful answer on the customer's own page, on whatever device they have, and the customer's site is never slowed or broken by it.

## Positioning

One hosted widget, white-labelled per customer, that puts a Purple Fabric agent on any site in under an hour while keeping every agent detail and credential off the visitor's browser.

## Operating Context

- The widget lives on someone else's page: it must coexist with any host design, script or content policy, and never break the page.
- Closed, it is a small launcher over the customer's page. Open, it is a chat panel on larger screens and the whole screen on phones.
- A first answer takes two to five seconds to start, and long answers stream in over many seconds.
- Customers configure each widget's title, colour and logo, welcome text and suggested questions.

## Capabilities and Constraints

- Base version for 22 November 2026: anonymous and signed-in visitors, streamed Markdown answers (tables and code included), conversation history for signed-in visitors, a permanent notice that the visitor is talking to an AI assistant.
- Loader on the host page: at most 6 KB compressed, plain TypeScript, no framework. Chat inside an iframe: React, at most 100 KB compressed on first load.
- No Purple Fabric address, identifier, token or raw error ever reaches the browser (R13). A visible "Powered by Purple Fabric" credit is a deliberate brand statement and is allowed.
- English first; text comes from a string catalogue and layout is direction-neutral, so other languages and right-to-left scripts are translation work.
- Undecided: whether the credit links anywhere, and whether a customer may hide it.

## Brand Commitments

- The widget wears the customer's brand: their title, brand colour and logo, configured per widget. Nothing of ours appears except one small "Powered by Purple Fabric" note inside the open chat. The launcher carries only the customer's colour.
- The closed launcher is small and out of the way: an icon-only round button with a spoken name, covering as little of the host page as possible.
- Voice: plain and neutral. Short, literal sentences a non-native English reader understands on first read.

## Evidence on Hand

- No customer logos, colours or content are in the repository. The College's real branding has not been supplied; test pages use labelled sample values.
- No testimonials, metrics or customer quotes exist. None may be invented.

## Product Principles

1. The host page comes first: the widget never breaks, slows or crowds the customer's site.
2. The customer's brand, not ours: every visible choice follows from the widget configuration.
3. Understood on first read, by everyone: plain words, large enough targets, every state announced.
4. Nothing about the agent leaks: what the visitor sees is built from an allow-list.

## Accessibility & Inclusion

WCAG 2.2 AA for the launcher, the chat and the admin console. A customer's brand colour must never break contrast. Full keyboard use, screen-reader announcements for completed answers, reduced motion respected, usable at 200% and 400% zoom and inside native-app web views.
