# Trailer craft

Rules that make a feature trailer feel like a film instead of a slideshow. Sources: HeyGen's
HyperFrames skills (`product-launch-video`, its `cut-catalog.md` and `motion-language.md`,
Apache-2.0) and our own trailer sessions.

## Story

- **One promise per feature.** The tagline says what the viewer gets ("Watch videos live with
  friends"), not what was built ("Synced YouTube rooms"). Name features as the product names them
  today; check the live app or database, names drift.
- **Value before evidence.** Title card states the benefit, then 2–4 shots prove it:
  setup → action → payoff (the confetti, the win screen, the notification arriving).
- **Order by appeal**, strongest first or last. Smaller items (a batch of new catalog entries)
  go in a grid card, not a full feature section.
- **Write for the audience.** The same footage makes a teacher cut and a kids cut; change the
  copy and the CTA, not the shots.
- **One CTA** at the end, concrete ("RSVP in Events"). A sneak peek ("coming soon") goes right
  before the outro: it's the last thing they remember besides the CTA.
- **Teasers hint, they don't tell**: a blurred or cropped glimpse, a question ("Something for
  Roblox fans..."), no specifics that could change.

## Pacing

- Cut on the beat. Pick a BPM (120–140 for hype, ~105 relaxed) and make every segment a whole
  number of beats; shots of 4 beats (~1.9 s at 128) are the default, title cards 4, panels 8–12.
- Speed footage up until only the payoff moments remain, typically x2–x4. Above ~x5 UI becomes
  unreadable; crop or pick a shorter span instead.
- Never show loading, idle cursors, typing a URL or browser chrome. Crop it away (`crop`).
- Punch in: crop to the region that matters (a notification, a button) for detail shots; a slow
  push-in (`zoom` 1.05–1.15) keeps every shot moving.
- Total length: 20–35 s for a social cut, 45–75 s for a full announcement.

## Motion (from HyperFrames' cut catalog)

- **Cut at peak velocity, match direction on both sides of the cut.** Title cards exit with a
  zoom-through (scale up + blur), the next shot enters with a small scale punch: one continuous
  forward motion.
- Big words arrive from oversized (inverse zoom: 1.5 → 1 with blur 10 px → 0) for payoff beats
  (intro word, outro head).
- Text blur peaks around 10 px; full-frame surfaces can take 18–20 px.
- Keep holds alive with a slow drift, not with bouncing. One move per element per beat.

## Sound

- Music sits on the same BPM grid as the cuts; the drop lands on the first feature. Prefer the
  product's own music (games often ship tracks) over generic beds.
- Every card change gets a whoosh; every title card a low impact; captions a pop.
- Put SFX on on-screen moments (a click, a reveal, a gift sent): the product's own UI sounds
  first, then the library. A sound whose hit isn't at its start gets `hit_offset`.
- Loudness: about -14 LUFS integrated, -1.5 dBTP; music under SFX, quieter intro.

## Review

- Contact sheets ≤1500 px JPEG; never read full-res frames or sheets into context (they once
  blew past the model's request size limit and stalled a session).
- Check every title card and the outro at 1280 px for clipped or overflowing text, wrong names,
  test data or dev badges.
- When notes come in, change the spec and rerun; only changed segments re-render.
