# Supported Browsers and Devices

Status: first version, 12 November 2026. This is the output of plan task M0-T7, and it serves requirement R4 (phone, tablet, foldable and laptop).

## 1. Browsers

We support the **current and previous major version** of each browser below. Anything older is not tested. On an older browser the loader does nothing rather than break the page, because no error may reach the host (M1-T10).

| Browser | Platforms | Tested on every build | Tested on real devices, each release |
|---|---|---|---|
| Chrome | Windows, macOS, Linux, Android, ChromeOS | Playwright Chromium, desktop and a phone profile | Android phone |
| Edge | Windows, macOS | Playwright Chromium (the same engine) | |
| Firefox, plus its current extended-support release | Windows, macOS, Linux | Playwright Firefox | |
| Safari | macOS, iOS, iPadOS | Playwright WebKit (close to Safari, not identical) | iPhone and iPad |
| Samsung Internet | Android | | Samsung phone and foldable |
| App web views: WKWebView on iOS, Android System WebView | iOS, Android | | One native-app web view on each |

Not supported: Internet Explorer, the old Edge (before Chromium), Opera Mini in its server-rendering mode, and browsers with JavaScript turned off. Without JavaScript the host page is unaffected: the launcher simply does not appear, and the "other ways to get help" link on the customer's site remains the route to a person.

Every build already runs on Chromium, Firefox, WebKit and a phone profile (`e2e/playwright.config.ts`). Real-device testing starts before production, not in the 22 November base version (plan section 14). It uses a device cloud, BrowserStack or AWS Device Farm (plan section 12).

### What the code is built for

These floors are older than the support policy, so a supported browser is never cut off by the build. Below the policy line the code may still run, but nobody checks.

| Part | Built for | Set in |
|---|---|---|
| Loader on the host page | ES2019 | `web/loader/package.json` |
| Chat in the iframe | Chrome 111, Edge 111, Firefox 114, Safari 16.4, iOS 16.4 (Vite 8.3's default target) | `web/widget/vite.config.ts` (no override) |

## 2. Devices and screen sizes

The chat lays itself out by the width of its own frame, from 280 px up (M2-T3).

| Kind | What is checked | Widths in the visual tests (px) |
|---|---|---|
| Phone | Full screen, portrait and landscape; the on-screen keyboard never covers the input; safe areas around notches; rotation during a streamed answer | 280, 344, 360, 390 |
| Foldable | Folded and unfolded, and the change between them during a conversation | 344 (folded cover screen), 600 |
| Tablet | Portrait, landscape and split view | 768, 1024 |
| Laptop and desktop | Floating panel, inline placement and full page | 1024, 1440 |

| Real devices, each release (M2 tests) |
|---|
| An iPhone on current iOS, with Safari and with an app web view |
| An Android phone with Chrome and with an app web view |
| A Samsung phone with Samsung Internet |
| One foldable (for example a Galaxy Z Fold), folded and unfolded |
| An iPad in split view |

## 3. Conditions the widget must survive

| Condition | Why | Checked in |
|---|---|---|
| Third-party cookies blocked; storage in iframes partitioned or cleared | Safari and other browsers isolate storage inside a third-party iframe (plan section 3, finding 5) | M1, M2 |
| A strict content policy on the host page | The host adds only our one origin, in `script-src`, `frame-src` and `connect-src` | M1 host matrix |
| Zoom at 200% and 400%; reflow at 320 px | WCAG 2.2 AA | M1, M2 |
| Reduced motion; high-contrast and forced-colours modes | WCAG 2.2 AA and user settings | M1, M2 |
| A right-to-left host page | Direction-neutral layout from day one | M1, M2 |
| A slow connection and a low-end Android phone | Size budgets: loader at most 6 KB compressed, chat first load at most 100 KB compressed | M2 performance tests |
| A corporate proxy that buffers streamed replies | The plain JSON reply takes over (D2) | M2-T6 |

## 4. Assistive technology

Scripted manual passes each release (M2):

| Screen reader | With |
|---|---|
| NVDA | Firefox and Chrome on Windows |
| VoiceOver | Safari on macOS and on iOS |
| TalkBack | Chrome on Android |

Automated checks with axe-core run inside the Playwright tests from module M2 onward.

## 5. Reviewing this list

Review it at each release. Proposed rule, for you to confirm: when a browser's market share among the customer's visitors drops below about one per cent, or a vendor ends support for a version, it can leave the list. Adding a browser means adding it to the device cloud runs, and to Playwright where Playwright can emulate it.
