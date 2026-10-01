# Apple Watch app for ag (scoping, 2026-10-01)

Status: **scoping**. Nothing built yet.

## Goal

A complication on the watch face. One tap starts a voice note; the recording is sent to the ag
inbox and becomes the first prompt of a **new** session in Inbox (no follow-on routing).

## What already exists

The server side is done. `ag-inbox` (`POST /prompt`, port 7373) already takes:

- a multipart `audio` field (m4a/caf/wav), saved to `~/inbox/capture/` and transcribed with Whisper
  on TrueFoundry; the transcript becomes the prompt;
- `id`: a repeated id within 24 h is acknowledged without opening a second tab, so an offline
  queue can resend safely;
- `new=1`: always a new session, never routed into an open one;
- `source`: free-form origin tag (we'd send `watch`).

So the watch only has to record, queue, and upload. The iPhone Action Button flow
(`ios-shortcuts/capture-to-ag.md`) is the model.

## The one real problem: reaching ag from the watch

The inbox is **tailnet-only**, and watchOS can't run Tailscale. Options:

| | Path | Works away from phone | Risk |
|---|---|---|---|
| A | Watch → paired iPhone's network → tailnet IP | no | Watch traffic proxied through the iPhone doesn't reliably go through the iPhone's VPN. Unverified; needs a spike. |
| B | Watch app → `WCSession.transferFile` → companion iPhone app → inbox | no (queues until near phone) | Needs an iOS app too, and the phone's Tailscale must be up. iOS wakes the app for file transfers, but timing is up to iOS. |
| C | Watch → **public HTTPS endpoint** (Tailscale Funnel) with a per-device token | **yes** (Wi-Fi/LTE/phone) | Puts one route on the internet. Mitigated: only `POST /watch`, bearer token from the vault, size cap, rate limit, audio only. |

**Recommendation: C.** Funnel is already permitted for our devices in `tailscale/policy.hujson`.
Expose a narrow route (e.g. `https://ag-engine.tail44736d.ts.net/watch` on funnel port 443 or
8443) handled by `ag-inbox`, which checks `Authorization: Bearer <token>` and then runs the
existing audio path with `new=1`, `source=watch`. The token lives in `op-work`; the watch app gets
it once at build time (xcconfig, not committed).

## Watch app design

- **watchOS-only app** (no iOS app needed with option C), SwiftUI, watchOS 26 / Xcode 26 on ag-mac.
- **Complication**: WidgetKit `accessoryCircular` + `accessoryCorner` (mic glyph) with
  `widgetURL(ag://record)`. Tapping it opens the app straight into recording.
  watchOS won't let a complication record without bringing the app forward (mic needs the
  foreground), so "one click" = tap complication → already recording → tap Stop (or the
  Double Tap gesture) → haptic "sent".
- Also expose a **Control** (AppIntent) for Control Center, and the Action Button if the watch is
  an Ultra.
- **Recording**: `AVAudioRecorder`, AAC m4a, mono 16 kHz (small uploads; Whisper is fine with it).
  Discard under 1 s. Optional max length (e.g. 5 min).
- **Queue**: write `<stamp>.m4a` to the app container first, then upload with a background
  `URLSession` upload task; delete on 2xx; retry on next launch / connectivity change. `id` = stamp.
- **UI**: one screen. Big red Stop while recording with elapsed time; afterwards a status row
  (sent / queued N). No settings screen.

## Build and install

- **Signing is the blocker.** ag-mac has **0 code-signing identities**. A free personal team
  re-signs every 7 days, which won't work for an always-on complication. We need the **Apple
  Developer Program** ($99/yr, Ramp card) and an **App Store Connect API key** stored in
  `op-work`.
- Distribute via **TestFlight** (builds from ag-mac with `xcodebuild` + `altool`/fastlane, no
  device cabling). Nathan installs once from the TestFlight app on the watch, then adds the
  complication to his face.
- Source lives in ag: `apps/ag-watch/` (Xcode project), with a `README` and a build script.

## Phases

0. **Spike (no app, ~30 min):** a watchOS Shortcut "Voice to ag" (Dictate Text → Get Contents of
   URL) on a Shortcuts complication. Proves whether option A reaches the tailnet IP via the phone,
   and gives Nathan a working button today (text dictation only, phone nearby).
1. **Server:** funnel route + token in `ag-inbox`; test with `curl` from off-tailnet.
2. **Developer account + API key** (needs Nathan: enrolment, Ramp card, maybe identity check).
3. **Watch app MVP:** complication → record → queue → upload. TestFlight build.
4. **Polish:** Control / Action Button, Double Tap to stop, offline queue count on the
   complication.

## Open questions for Nathan

1. Watch model: Ultra (Action Button)? Cellular?
2. OK with a token-protected public endpoint (option C), or keep everything tailnet-only and
   require the phone nearby (A/B)?
3. Is there already an Apple Developer account (personal or Trilogy) to use, or enrol a new one?
4. Should a watch note ever route into an open session like the phone's captures do, or always new?
