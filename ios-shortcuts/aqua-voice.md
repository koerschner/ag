# Aqua Voice (iPhone dictation keyboard)

The user's dictation keyboard on the iPhone, chosen 2026-10-03 over Wispr Flow, Willow and
Superwhisper (Reddit/X and benchmarks: most accurate and fastest on iPhone, tuned for technical
words). Used for typing prompts anywhere, including the **Capture to ag** "Ask for Input" box
(`capture-to-ag.md`); iOS keeps the last-used keyboard, so that shortcut needs no change.

- **Account:** The user's personal account, Aqua Voice Pro (unlimited). One subscription covers Mac and
  iPhone; dictionary and settings sync.
- **App:** Aqua Voice: AI Dictation (App Store id 6759074969), v1.0.38 at setup.
- **Keyboard:** Settings › General › Keyboard › Keyboards › Aqua Voice, **Allow Full Access** on.

## App settings (set 2026-10-03)

| Setting | Value |
|---|---|
| Model | Avalon 1.5 |
| Language | Auto-Detect |
| Microphone timeout | **1 hour** (longest; fewer bounces back into the Aqua app) |
| Use built-in mic | On |
| Casual messaging | Off |
| Play sounds | On |
| Haptic feedback | Subtle |
| Show full QWERTY keyboard | On |
| Privacy mode | Off |
| Custom instructions, Replacements | none |

**Dictionary:** ag, ag-dash, ag-mac, ag-engine, ag-client, pi, Jev, arcade.school, Linear,
Discord, tmux, CUA, Claude, Codex, Opus, PR, and the user's full name.

## Shortcuts actions it provides

- **Quick Dictation**: start or stop Aqua dictation from anywhere.
- **Stop Dictation**: stops the current dictation.
- **Turn Off Hot Mic**.

They show as "Unknown Action" in ag-mac's Shortcuts editor (the app isn't installed there), so
build or test shortcuts that use them on the phone.

Note: iPhone Mirroring doesn't show the on-screen keyboard, so the keyboard itself can only be
tested on the physical phone.
