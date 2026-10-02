---
name: mobile-review
description: Adversarially review a web app on a simulated iPhone and make sure every button, gesture and screen actually works (tap every control, catch freezes, safe areas, on-screen keyboard, landscape, target sizes), then fix what breaks. Use for "mobile review", "test it on mobile/phone/iPhone", "the X/button doesn't work on my phone", and before shipping any change to a mobile layout. Includes a ready-made suite for AG Dash (http://ag:7376, the iPhone home-screen app).
---

# Mobile review

Goal: prove every control works on a phone, the way a finger uses it, and fix what doesn't. Be adversarial:
assume something is broken until you've tapped it, and look for the ways phones differ from the desktop.

Two tiers. Run tier 1 always; confirm with tier 2 when the bug is iOS-specific or before telling Nathan a
phone bug is fixed.

1. **Playwright iPhone** (fast, scriptable, safe on live apps): `scripts/phone.mjs`. Chromium with the iPhone
   15 Pro profile (touch, 393×659, mobile UA, `pointer:coarse`), iPhone safe areas substituted into the page,
   and **every write request stubbed** (answered `{ok:true}` and recorded) so tapping Send / Archive /
   Interrupt against the real app has no side effects. Playwright's WebKit can't start its web process on
   macOS 26 here, so the engine is Chromium; engine-independent bugs (JS, layout, hit-testing) show up fine.
2. **Real Mobile Safari** in the iOS Simulator, driven with AXe: `scripts/sim.sh`. Real iOS WebKit, real
   Dynamic Island, real Safari chrome. Writes are NOT stubbed here: only tap things with harmless effects
   (open/close, tabs, scrolling), or your own session's card.

Setup once per machine: `scripts/setup.sh` (Playwright + browsers into `~/.local/share/mobile-review`, AXe into
`~/.local/share/axe`). For tier 2 also an iOS runtime: `xcodebuild -downloadPlatform iOS` (~8 GB, minutes).

## AG Dash

Page: `ag-board/dot-local/share/ag-board/index.html` in the ag repo (`~/ag`) (served by `bin/dot-local/bin/ag-board`,
re-read on every request, so a saved edit is live at once). Nathan uses it as a home-screen app on his
iPhone via `https://ag.<tailnet>.ts.net:7377` (the board redirects there for the mic).

```sh
S=~/.agents/skills/mobile-review/scripts
node $S/agboard.mjs                              # the live page: ~140 checks, PASS/FAIL/WARN, exit 1 on failure
PAGE=/path/to/edited/index.html node $S/agboard.mjs   # test an edit before it goes live
```

Screenshots land in `/tmp/mobile-review/agboard/` (plus `landscape/`); look at them, don't just trust the
table. It covers: header (views, Pinned only, filter), column tabs and swipe (incl. the strip not snapping back),
card ▾ details and every details button, long-press → pin, Archive + Undo, the drawer opened/closed repeatedly,
every drawer action, Transcript/Live tabs, key buttons, tool-call disclosure, reply with the keyboard up,
Send, 📎 attach, 🎙 voice (no mic → must not hang), Mark unread, rename prompt, New session dialog, deep links
(live and closed/read-only session), media viewer, target sizes, landscape, page errors.

**When you change the board's mobile UI, add checks for the new controls to `agboard.mjs` in the same change,
and the suite must pass before you commit.**

Then confirm in real Safari:

```sh
$S/sim.sh boot && $S/sim.sh open https://ag.tail44736d.ts.net:7377/
$S/sim.sh shot s1                # read /tmp/mobile-review/s1s.png (point-sized: tap coords = pixels)
$S/sim.sh tap 100 252            # open your own session's card (opening marks a card seen)
$S/sim.sh tap 368 92             # ✕
$S/sim.sh ui                     # accessibility tree with frames when you need exact targets
```

## Any other app

Write a small script with the library (import it by absolute path):

```js
import { launchPhone, tapCheck, alive, sweep, withKeyboard, kbVisible, reporter } from "/Users/<you>/.agents/skills/mobile-review/scripts/phone.mjs";
const { page, writes, errors, shot, browser } = await launchPhone({ url, pageFile, stubReply, viewport });
```

- `tapCheck(page, sel)`: scrolls to it, checks a finger at its centre would hit it (not covered, on screen),
  taps, then checks the page is still alive. Returns `{ok, why}`.
- `alive(page)`: the main thread answers within 2 s. **Always check after taps**: a frozen page looks exactly
  like "the button doesn't work".
- `sweep(page, root)`: every visible control with size, `tiny` (<32pt: fail), `small` (<40pt: warn), and
  overlap with the status bar / home indicator.
- `withKeyboard(page, fn)` + `kbVisible(page, sel)`: the iOS keyboard as Safari does it (only
  `visualViewport` shrinks; `100dvh`/fixed boxes don't), so you can check the input and Send stay visible.
- `writes`: every stubbed POST/PUT/DELETE (`{method, path, body}`): assert the right request was made.

## Adversarial checklist

Tap **every** button, link, tab, toggle and menu item, then for each:
- It does the thing (state changed / right request recorded / dialog opened) and can be undone or closed.
- The page is still alive afterwards. Open and close things several times in a row, not once.
- Nothing covers it: status bar, Dynamic Island, home indicator, sticky headers, toasts, the keyboard.
- It's big enough (Apple asks for 44pt; under 32pt is a bug).

Then the phone-specific traps:
- **Observer/re-render loops.** A MutationObserver (or effect) that writes the attribute it observes loops
  forever: `classList.remove()` / `toggle()` rewrite `class` even when nothing changes. Guard writes with
  `contains()`. This froze the board when ✕ was tapped (2026-09-28).
- **Re-rendering mid-tap.** Replacing a button's element (innerHTML) between touchstart and click eats the
  tap; update text in place. Periodic scrollIntoView yanks a strip the user is swiping.
- **Keyboard.** Input, Send and a way to close stay visible with the keyboard up; iOS zooms fields under 16px.
- **Safe areas + landscape.** Notch side insets in landscape; a wide-but-short screen shouldn't get the
  desktop layout if it leaves no room.
- **Touch-only gestures.** Long-press, swipe, and that the click after a long-press is swallowed; nothing
  relies on hover or keyboard shortcuts.
- **Dialogs** (`prompt`, `<dialog>`, file picker) open, fit on screen and close.
- **Deep links / reload / back** land in the right state and close cleanly.
- **Network.** Reconnect after the app is backgrounded; failed writes restore the user's input.

## Report

For Nathan: what you tapped (the pass count), each bug found with its root cause and fix, what you
confirmed in real Safari, and anything you couldn't test (e.g. mic, standalone home-screen mode). Build a
visual review page (visual-review-page skill) when the change is visible, and `show` the screenshots.
