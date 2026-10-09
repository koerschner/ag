---
name: feature-trailer
description: Turn a list of features plus screen recordings / gameplay clips into a punchy, beat-synced trailer (title cards per feature, sped-up framed shots with push-ins and callouts, music, whooshes and moment SFX, CTA outro). Use for "make a trailer / promo / sizzle reel / launch video for these features", release-notes videos, "what's new" videos, and audience variants (e.g. a teacher cut and a kids cut) of the same footage.
---

# Feature trailer

Given features and clips, produce a 20–90 s 1080p trailer. The engine is `scripts/trailer.py`:
a JSON spec in, an mp4 out. You do the editorial work (choosing moments, copy, pacing); the
script does the rendering, so iterating on notes is "edit the spec, rerun" (unchanged cards and
segments are cached).

Craft rules distilled from HeyGen's HyperFrames launch-video skills and from our own trailer
sessions are in `references/craft.md`. Read it before writing the spec. If `~/ag-personal/notes/trailers.md` exists, read it too: the
user's house style, music and sound sources, audiences, and past trailers.

## Inputs to collect

1. **What shipped**: the user's list, cross-checked against the source of truth (recent merges,
   new rows in the catalog/events tables, the team chat). Real current names come from the live
   app or database, not ticket titles. If the user names something you can't find any trace of,
   don't stall: make a placeholder (key art from `ag-image`, vague copy) and flag it in the report.
2. **Clips** for each feature. Look before asking: recordings from earlier sessions this week
   (`ag find`, `find ~ -newer ... -name '*.mp4'`), screen-recorder folders, a dated
   `Trailer YYYY-MM-DD` folder. macOS privacy can block reading the client's Desktop over ssh;
   `~/Screenshots` or a computer-use job on the Mac works. Missing footage: record it yourself
   (Playwright on the real page, below) or take a fresh screen grab of production with computer use.
3. **Audience + CTA**: who watches (guides? kids? parents?) and the one action at the end.
   Write copy for that audience ("play with your students" vs "play with your friends").
4. **Brand**: theme colours, fonts (`.ttf`), key art, cover art for anything featured (events,
   catalog entries: download the real images), and the product's own music and UI sounds.
5. **Data the trailer shows**: if a screen shows a name that's about to change (an event series
   being renamed), change it in the product first, then capture, so the trailer and the app agree.

Ask only for what you can't find. Under "Run it", an overnight brief, or any autonomous request,
make the calls yourself and list them in the report.

## Workflow

Work in a project dir, e.g. `~/trailers/<yyyy-mm-dd>-<topic>/` with `clips/`, `art/`, `sfx/`.

1. **Ingest**: raw screen recordings are often huge (Retina, 3000+ px, 250 MB). Make a 1920-wide
   30 fps proxy first (`ffmpeg -i raw.mp4 -vf "scale=1920:-2,fps=30" -an -crf 17 clip.mp4`), and plan
   a `crop` that removes browser chrome and dev/staging badges.
2. **Inventory** every clip (never read full-res frames into context; the sheets are ≤1500 px):
   ```bash
   S=~/.agents/skills/feature-trailer/scripts
   $S/inspect.sh inspect clips/*.mp4          # per clip: length, size, audio?, contact sheet, busiest seconds
   ```
   Read each `inspect/<clip>-sheet.jpg`. The busiest seconds are action candidates; confirm on
   the sheet, then pull a few downscaled frames and `hstack`/`vstack` them into one grid image
   when you need precision (one read instead of several). Note exact source times of moments
   worth a sound (a click, a reveal, a win screen).
3. **Plan**: per feature 2–4 shots, each a payoff moment, ordered setup → action → result. Pick a BPM
   (120–140 energetic, ~104 relaxed) and give every segment a whole number of beats.
4. **Write the spec(s)**. For more than one cut, write a small `make_specs.py` that builds every
   variant from shared feature functions and per-audience copy dicts (feature order, short vs full
   shot lists, BPM, key); editing one place updates every cut. Check the timeline without
   rendering: `python3 $S/trailer.py spec.json --plan`.
5. **Test new cards alone**: when you add or change a card type, render a throwaway spec with just
   that segment (`intro`/`outro` null, its own `build_dir`) and check frames before a full build.
6. **Render** in the background: a 60 s cut takes ~7 min cold, much less cached. Run a
   `build_all.sh` loop over the specs in its own tmux window, poll its log, and review each cut's
   sheet as it lands instead of waiting for all of them.
7. **Self-review** before showing anyone: read `build/sheet.jpg`, then single frames of each title
   card and the outro at 1280 px. Check: text never clipped or overflowing, each shot shows its
   moment (not loading screens or a cursor idling), names correct, no dev badges or test data
   that looks wrong. Check loudness lands near -14 LUFS with true peak below 0 dBTP **on the final mp4** (AAC overshoots the WAV; the mix ends in a limiter for that), and look at the waveform
   (`showwavespic`): one loud sound effect squashes everything else after normalising.
8. **Show it**: one review page with every cut (video, contact sheet, what each variant is, and
   the judgment calls), opened with `ag-show`; copy the mp4s to the client's `~/Movies/`. If the
   client is asleep, queue the copy with an `ag-tickler` `when: "online"` item.
9. **Publish** when asked: upload to the video host the product embeds (verify the link plays and
   its visibility), book it where the product announces things, and post a short note for the
   audience (the link, one line per feature, the CTA). Read every post back; markdown conversion
   can glue a bullet onto a URL, so prefer the tool's structured blocks for links and lists.

## Getting creative: footage that doesn't exist yet

When a feature can't be filmed for real (it needs a camera, a real child's face, a paid AI call,
production data that isn't there), build the footage from the product's own components:

- **Storybook as a film set.** Add a throwaway story in a scratch worktree (never committed) that
  wires the real component to faked doors: canned delays that mimic the real pacing, results that
  point at your generated assets. Record it with Playwright `recordVideo`; scale the page with
  `document.documentElement.style.zoom` (not a small viewport + deviceScaleFactor, which records
  at the small size) and keep a drawn cursor whose position is divided by the zoom.
- **A fake camera.** Generate a fictional person with `ag-image` (ask for "laptop-webcam photo …
  no phone, no UI": otherwise it draws a phone-camera screen), loop it into a gently drifting
  `.y4m`, and launch full Chromium (not the headless shell) with
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=cam.y4m`.
  For WebGL effects (background segmentation) add `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. A story's own fake-camera fixture can be swapped for the browser's
  camera behind a URL flag.
- **Run the product's real prompts yourself.** For AI output (e.g. avatar styles), read the
  prompt and per-style text from the repo and run them through `ag-image -i <photo>`; key out the
  flat backdrop colour with numpy (`uv run --with pillow`), then composite onto the product's
  shipped backgrounds.
- **Network the story expects**: `page.route` the API it calls (e.g. an image door) to local files.
- **Names and test data on screen**: `RENAME="From=To"` in the recorder rewrites text nodes, and
  blur codes/test values (`crop`+`boxblur`+`overlay`) on stills from PRs.
- Effects that initialise (segmentation, players) glitch on their first frames: start shots after.

## Spec format

Paths are relative to the spec file. Every segment length is in beats of `bpm`.

```jsonc
{
  "out": "whats-new.mp4",
  "bpm": 128,
  "theme": { "bg": "#070b18", "bg2": "#16306b", "accent": "#3d8bff", "accent2": "#ffd447", "ink": "#ffffff", "muted": "#c6d3f5" },
  "fonts": { "display": "fonts/Display-Bold.ttf", "body": "fonts/Body.ttf" },   // optional
  "music": { "key": "A", "mode": "major" },        // generated bed, drop on the first feature
  // or { "file": "music.wav", "offset": 0, "volume": 0.9 } (should match bpm), or { "file": false } for none
  "intro": { "label": "Just landed in", "head": "Acme", "sub": "3 new things to try", "beats": 8 },
  "features": [
    {
      "name": "Gifting", "title": "Gift<br>a friend",       // title: card text (optional, <br> for 2 lines)
      "tagline": "Send a friend something from the Shop", "sub": "Pick an item, pick a friend, hold to send.",
      "color": "#ff7a1a", "color2": "#ff3d6e",                // feature accent pair
      "art": "art/gifting.png",                               // optional; default: a still from the first shot
      "title_beats": 4,
      "shots": [
        { "clip": "clips/1-send-gift.mp4", "in": 3.0, "out": 9.5, "beats": 4,   // 6.5 s of source in 4 beats (x3.5)
          "caption": "Pick an item", "caption_at": 0.3,
          "zoom": 1.12,                                       // push-in by the end of the shot (default 1.06)
          "crop": [0, 0, 1280, 720],                          // optional source crop x,y,w,h (punch into a region)
          "sfx": [[8.9, "pop"], [9.2, "sparkle", 0.8]],       // [source_time, sound, vol?, hit_offset?, pre?]
          "audio": 0.6 },                                     // optional: keep the clip's own sound (pitch kept)
        { "clip": "clips/1-send-gift.mp4", "in": 20, "speed": 2.0, "beats": 4 }  // speed instead of out
      ]
    },
    { "kind": "panel", "label": "New in the Shop", "head": "New<br>items!", "body": "Bows, tridents and more.",
      "clip": "clips/shop-scroll.mp4", "in": 0, "out": 6.6, "beats": 12, "color": "#ffd447",
      "win": [900, 150, 900, 780] },                          // text left, looping clip right
    { "kind": "panel", "label": "New in Minecraft", "head": "PvP", "body": "...", "image": "art/key.png",
      "win": [960, 140, 800, 800], "zoom": 1.15 },            // a still with a slow push (no footage yet)
    { "kind": "panel", "label": "Sneak peek", "head": "Coming<br>soon", "clip": "clips/x.mp4", "in": 15, "out": 21,
      "crop": [470, 140, 580, 330], "blur": 5 },              // teaser: a blurred glimpse
    { "kind": "grid", "label": "Also new", "head": "New games", "tiles": [["art/a.png", "Game A"], ["art/b.png", "Game B"]] },
    { "kind": "lineup", "label": "Oct 12–16", "head": "Event week", "foot": "RSVP now!", "step": 2,   // items pop in one per `step` beats
      "items": [{ "img": "art/e1.webp", "name": "Trivia", "when": "Mon" },
                { "img": "art/e4.webp", "name": "Mystery Movie", "when": "Fri", "mystery": true }] }  // shrouded, lands last on a riser
  ],
  "outro": { "head": "Try it<br>now", "sub": "in Acme", "cta": "RSVP in Events", "beats": 12, "tiles": true },
  "auto_sfx": true,                                           // whoosh/impact on cards, pop on captions, sparkle on the outro
  "sfx": [[12.5, "riser", 0.6]]                               // extra sounds at absolute output times
}
```

Sounds: a name from the built-in library (fetched once from the HyperFrames repo, Pixabay
licence: `whoosh`, `whoosh-short`, `whoosh-cinematic`, `impact-bass-1/2`, `riser`, `pop`, `click`,
`click-soft`, `key-press`, `typing`, `ping`, `chime`, `sparkle`, `notification`, `error`,
`glitch-1/2/3`) or a path to any audio file. Prefer the product's own sounds for in-app moments
(an app's UI sounds: reward, unlock, confirm, message-sent...). `hit_offset` lines up a sound whose hit isn't at its start
(e.g. a drum roll whose crash is 2.05 s in); `pre` plays only that many seconds before the hit
(a 10 s riser with `hit_offset` 10, `pre` 2 swells for 2 s into the moment). Library sounds are
cut to 2.5 s with a fade, and title impacts are kept short and quiet: long, loud SFX swamp the
loudness normaliser and bury the music.

## Engine notes

- Cards are HTML (`scripts/cards.html`), rendered frame-by-frame in headless Chromium
  (`frames.ts`, Playwright). To add a new card type, add a `setupX(args)` that defines
  `window.render(t)` there and a segment kind in `trailer.py`.
- Shots: trimmed, retimed to fill their beats, covered into a rounded 16:9 window over a blurred
  plate of the feature art, with a slow push-in and a small punch on entry, the feature's name tab,
  and an optional caption chip.
- Music: `music.ts` synthesises a bed on the same BPM grid (pads + arp intro with filter sweep,
  riser and snare roll into a drop at the first feature, four-on-the-floor groove, final hit
  under the outro). Use real music when the product has it; the generated bed is a fallback.
- Mix: everything summed, faded, `loudnorm` to -14 LUFS / -1.5 dBTP; AAC 256k, `+faststart`.
- Needs: `ffmpeg`, `bun`, and Playwright's headless shell
  (`bunx playwright install chromium-headless-shell` if `~/.cache/ms-playwright` lacks it).
  The bun helpers run from a copy in `~/.cache/feature-trailer/runtime` (deps installed there on
  first use), so the skill checkout stays clean.
- Recording missing footage: drive the page with Playwright `recordVideo` at 1920x1080, draw a
  cursor overlay so clicks read, and use the app's keyboard paths for fast, reliable input.
- Still art (a feature with no footage yet): generate key art with `ag-image --aspect 1:1` and use
  a panel with `image`.

## Going further

For a fully art-directed launch film (voiceover, GSAP motion, per-frame design system, site
capture), use HeyGen's HyperFrames skills: `npx skills add heygen-com/hyperframes --skill product-launch-video`
(also `pr-to-video`, `hyperframes-audio`, `media-use`). They are heavier (HeyGen sign-in for music
and voice) but excellent; `references/craft.md` borrows their cut and pacing doctrine.

## History

Generalised from a two-variant games trailer built by hand in Oct 2026 (a teacher cut and a kids
cut of four games). What carried over: beat-grid cutting, the product's own music and stings, SFX
placed on on-screen moments, framed shots on a blurred art plate, audience variants from one
footage set, and contact sheets downscaled before reading (full-res sheets once blew past the
model's request size limit).
