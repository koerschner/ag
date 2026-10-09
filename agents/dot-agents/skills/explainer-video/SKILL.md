---
name: explainer-video
description: Make narrated explainer and product-walkthrough videos entirely in code - HTML/CSS/JS motion graphics (GSAP) over real product screens captured with a browser, AI narration with word-level timing, karaoke captions, product sound effects and a music bed - then grade and fix the render in a self-review loop until it passes. Use for "make a walkthrough / explainer / onboarding / how-it-works / tutorial video", animated explainers of a concept, videos of an app's screens (live site, dev server or Storybook), and for fanning out several style variants at once. For beat-cut feature trailers from screen recordings, use feature-trailer instead.
---

# Explainer video

A brief in, a narrated 1080p mp4 out, made the way the best teams do it now: no AI video
model, just code. The picture is an HTML page you write (GSAP timeline + the product's real
screens + any external images), rendered frame by frame in headless Chromium; the voice is
TTS whose word timings drive the animation and the captions. Because it is code, every note
is "edit, rerun", and you can grade your own output and keep improving it.

Scripts live in `scripts/` (this skill's directory); run them from the project dir:

```bash
X=~/.agents/skills/explainer-video/scripts
bun ~/.cache/explainer-video/runtime/capture.ts shots.json shots   # real screens (build.py installs the runtime on first use)
python3 $X/build.py video.json --stage tts      # narrate + print the timeline (fast, cached)
python3 $X/build.py video.json --draft          # half-size, 15 fps: check motion and timing
python3 $X/build.py video.json                  # final 1080p30 + review pack
```

Work in `~/trailers/<yyyy-mm-dd>-<topic>/` (`video.json`, `comp.html`, `shots/`, `art/`,
`sfx/`, `fonts/`). Product-specific notes (house style, brand, past videos) may live in
`~/ag-personal/notes/`: read `trailers.md` there if it exists.

## Workflow

1. **Understand the product, from the source.** Read the product's code or docs for the real
   rules and words (what unlocks what, the numbers, what the UI calls things). Never narrate
   a guess: a walkthrough that teaches the wrong rule is worse than none. Write the audience
   down (a new 10-year-old student? a parent? a teacher?) and talk to them.
2. **Script** in `video.json` `lines`: one idea per line, short spoken sentences, 60-90 s total
   for a walkthrough. Open with who/what, give the mental model in 3 steps, show each step,
   end with the one thing to do. Run `--stage tts` and read the timeline; rewrite lines that
   run long. The review's narration check flags lines the TTS garbled.
3. **Capture real screens** (`capture.ts`, see its header): a live URL, a dev server, or
   Storybook stories (`"story": "<id>"`; list ids from `http://localhost:6006/index.json`). Use
   `scale: 2` so zoom-ins stay sharp, `crop` to one component, `boxes` for elements you will
   ring or point at, `rename` for test names, `hide` for dev badges. No codebase? Drive the
   live site and save its HTML/CSS/JS (`html: true`) to re-animate it. Storybook is the best
   film set: every state of every screen, with clean fake data. Inventory with a contact
   sheet before choosing; trim uniform backgrounds off component shots.
4. **Collect external art**: the product's mascot and key art, game/partner thumbnails,
   the product's own UI sounds (best SFX there is), fonts. Real images beat drawn ones.
5. **Pick a style** from `references/styles/` (the master prompt for each look) and write
   `comp.html` with `ev.js` (see its header): one paused GSAP timeline, every tween placed
   at a narration cue (`EV.at('line')`, `EV.word('line', 'battery')`), counters and drawn
   meters in `EV.onFrame`, `EV.captions(el)` for karaoke captions. Fixed 1920x1080 layout.
   Preview live with `python3 -m http.server` in the project dir: `comp.html?play` or `?t=12.5`
   (copy `scripts/ev.js` and gsap next to it, or just render a draft).
6. **Sound**: `sfx` entries hit a line, a word (`"word:line:battery"`) or a time (`"t:12.3"`);
   the music bed is generated on a BPM grid (or a file) and ducked under the voice.
7. **Render a draft, then grade it** (the self-healing loop below). Final render only when
   the draft passes. A 75 s final takes ~4 min on 6 workers.
8. **Show it**: `ag-show out/video.mp4` plus a review page (visual-review-page skill) with the
   video, the contact sheet, the script, and your judgment calls; copy the mp4 to the client's
   `~/Movies/`.

## The self-healing loop

After every render, `review.py` writes `build/review/`: `sheet.jpg` (whole film), `cues.jpg`
(one frame per narration line), and `report.md` (Whisper's transcript vs the script,
loudness, black or frozen stretches, and the rubric). Then:

1. Read `report.md`, `sheet.jpg` and `cues.jpg` (never full-res frames; for detail, pull a few
   frames at 720 px and stack them into one grid).
2. Grade every item in `references/rubric.md` pass/fail, with the time of each failure.
3. Fix the failures in `comp.html` / `video.json` and re-render (`--draft` while iterating).
4. Repeat until every item passes, at most ~5 rounds; then render final and grade once more.
   Report what you fixed per round. Things you could not fix go in the hand-off, not under
   the rug.

Typical first-round failures: elements overlapping (mascot over the title, tags over
headings), content running under the captions, too much empty space or too little padding at
the edges, a scene empty for a second while waiting for its cue, numbers on screen that
contradict the narration (a real screenshot showing 45m beside a drawn meter at 6m), and
the picture lagging the words.

## Variants: many agents at once

Exploring looks is cheap: fan out. Write one brief file (product facts, audience, script,
captured `shots/`, art), then start one session per style or idea, each in its own copy:

```bash
for s in walkthrough vox kinetic diagram; do
  cp -r ~/trailers/<proj> ~/trailers/<proj>-$s
  ag spawn --label "video: $s" "Use the explainer-video skill in ~/trailers/<proj>-$s: rewrite comp.html in the '$s' style (references/styles/$s.md), run the self-healing loop to a pass, render final, and report the mp4 path."
done
```

Collect the finished cuts on one comparison page. Try odd ideas too; the point is range.

## Narration

`build.py` calls the TrueFoundry gateway (`$TFY_TOKEN`): default voice
`gemini-primary/gemini-3.8-flash-tts` (voices such as Puck, Zephyr, Kore; style goes in
`instructions`, never in the text, or it gets read aloud), or `openai-primary/tts-1-hd`
(`nova`, `alloy`...). Whisper (`openai-primary/whisper-1`) supplies word timings. The gateway
lists ElevenLabs models but does not support its speech endpoint (Oct 2026). Lines are cached
by text and voice, so editing one line re-voices only that line.

## Files

- `scripts/build.py`: narrate, time, render, mix, mux, review. `--draft`, `--from/--to` (partial frames), `--stage tts`.
- `scripts/capture.ts`: product screens and element boxes from a URL or Storybook.
- `scripts/render.ts`: deterministic frame renderer (parallel workers), serves `/lib/gsap.min.js` and `/lib/ev.js`.
- `scripts/ev.js`: composition helpers (cues, words, captions, seek).
- `scripts/review.py`: the review pack.
- `references/rubric.md`: what "good" means, item by item.
- `references/styles/*.md`: master prompts per look (walkthrough, vox, kinetic type, diagram).
- `examples/minimal/`: a 3-line project to copy as a starting point.

## History

Built Oct 2026 from a partner video team's experiments: Claude-made explainers
"100% code, no third-party content" (Vox, corporate, kinetic-type and diagram styles),
app walkthroughs built from browser screenshots animated with JS and ElevenLabs voices, the
advice to keep master prompts per workflow in Markdown, let the model review and grade its
own work until it meets a bar, and keep many agents producing variants at once. First used
for a 76 s product walkthrough for new students (Storybook stories as the screens).
