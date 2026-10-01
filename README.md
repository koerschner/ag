# ag

"always going" or "automatic gun", depending on how edgy you're feeling

Ag is Nathan's agent system: Herdr as the runtime, Pi as the harness, and everything around them
that makes it one system across his machines. It covers AG Dash, the ag inbox, the tickler,
presence, the client ↔ host bridge, computer use, 1Password and Tailscale access, the Linux engine's
infrastructure, the global agent instructions (`agents.md/`), and the skills.

Personal machine config (shell, editor, terminal, window management, Brewfile) stays in the public
[dotfiles](https://github.com/koerschner/dotfiles) repo. Its `bootstrap` clones this repo to
`~/ag` and runs `./install`; Linux machines run `./bootstrap-linux`, which installs both.

Design and roadmap: [`docs/ag.md`](docs/ag.md). Machine inventory: [`machines/README.md`](machines/README.md).

## Layout

Stow packages (stowed into `~` with `stow --dotfiles --no-folding`, alongside dotfiles' own packages):
`ag-board`, `ag-inbox`, `agents`, `bin`, `claude`, `codex`, `hammerspoon`, `herdr`, `pi`
(plus `systemd-user` on Linux). Not stowed: `agents.md/` (instruction sources), `ag-board-editor/`
(editor bundle source), `docs/`, `infra/`, `ios-shortcuts/`, `machines/`, `macos-apps/`,
`macos-launchagents/`, `tailscale/`.

- `./install` (Mac): agent CLIs, `agents.md/build`, git hooks, stow, LaunchAgents, helper apps, Herdr setup.
- `./bootstrap-linux`: the whole Linux machine (apt, both repos, services).
- `hammerspoon/dot-hammerspoon/ag.lua`: the client-side glue (inbox capture, Herdr shortcuts, image
  paste, tab links, role-specific power/activity). dotfiles' `init.lua` loads it with `pcall(require, "ag")`.

Keeping machines in sync: every change is committed and pushed to `main`, then pulled on every
machine in `machines/README.md` (`git -C ~/ag pull --ff-only`, then re-run `./install` or
`./bootstrap-linux` if install steps changed).

## Secrets (move by hand; never commit)

Transfer these from the old machine via 1Password (or AirDrop), keeping file
modes at `0600`:

| File | Contents |
|---|---|
| `~/.zshenv.local` | `TFY_TOKEN`, `BRAVE_API_KEY` (see *Machine-local AI gateway*) |
| `~/.gitconfig.local` | `[user]` name/email |
| `~/.zprofile.local` | machine-local profile overrides |
| `~/.profile.local` | machine-local POSIX login-shell additions (optional; the tracked `~/.profile` puts Homebrew first for `sh -lc`, e.g. the arcade pre-push hook) |
| `~/.config/mcp/arcade-school.headers`, `tsa-courses.headers` | `Authorization: Bearer <token>` |
| `~/.local/share/arcade-linear-return/mcp-destination/client-metadata.json` | Linear MCP OAuth client |
| `~/.pi/agent/auth.json` | or just run `pi` and `/login` |
| `~/.alchemy/config.json`, `~/.alchemy/credentials/playcademy-arcade/cloudflare.json` | Alchemy `playcademy-arcade` Cloudflare profile (API token); arcade's `bun scripts/db --stage production` needs it plus `cloudflared` |

Vault-only service keys (no local file; agents read them on demand with
`op-ag read`, piped straight into the calling process, never printed):

| Vault item (arcade.school vault) | Used for |
|---|---|
| `Discord bot (Arcade)` (**ag-vault**, via `op-work`) | Bot token for the `discord` CLI (read/post on the Arcade server as "Nathan's Assistant") and `discord dce` exports |
| `PostHog Personal API Key (Nathan Koerschner)` | PostHog REST API for project Playcademy (168029): feature flags (`arcade_*`) read/write, e.g. `GET https://us.posthog.com/api/projects/168029/feature_flags/?search=arcade_` |

1Password service-account tokens (login Keychain on ag, account `natkoersch`;
read only by the wrappers, never printed or put in files/args):

| Keychain service | Wrapper | Service account → vault (read_items + write_items only) | Recovery copy |
|---|---|---|---|
| `ag 1Password service account` | `op-ag` | `ag arcade.school agents canonical` → `arcade.school` (`jjbrfvemdg4y3prkikxur6thbq`) | Trilogy → Employee → `ag arcade.school service account` |
| `ag machine-shared service account` | `op-shared` | `ag machine-shared agents` → Nathan's personal `machine-shared` (`qxomga2s2ppd3agns74jhfz7yi`) | Nathan's personal account → Personal → `ag machine-shared service account` |
| `ag-shared 1Password service account` | `op-work` | `ag-shared agents` → Trilogy `ag-vault` (formerly `ag-shared`; `c3qkbcqktsxmi6hnpzpltdbose`; Keychain item keeps its old name): non-super-secret work items (Ramp card, infra API tokens) | Trilogy → Employee → `ag-shared 1Password service account` |

Alpha Slack session (login Keychain on ag, account `natkoersch`, written by `slack-session-auth store`;
no recovery copy, recreate by signing Slack in again): `ag Slack T8E6M88BS xoxc`, `ag Slack T8E6M88BS xoxd`.
See *Slack MCPs*.

ag's own macOS login password lives in ag's login Keychain (service `ag Mac login`, account
`natkoersch`), so agents answer ag's admin/password prompts (e.g. adding an app under Privacy &
Security) on ag without touching the client. Nathan stores or refreshes it once with
`ag-login-password set` (hidden prompt, verified with `dscl -authonly`); agents run
`ag-login-password type` with the prompt's password field focused, and `ag-login-password check`
to see if it's there. The client's Keychain copy can't be read over SSH (its Keychain is locked
to non-GUI sessions), and fetching it from the client is blocked by the client-CUA guard anyway.

`op-shared` and `op-work` are symlinks to `op-ag`; the script picks the Keychain item by the
name it was invoked as. On macOS it runs `op` with `HOME` pointed at a private empty
directory (`~/.local/state/op-wrapper/home`; `op run` children get the real `HOME` back), so
`op` never touches 1Password's Group Container. That access raised the TCC prompt "“bun”
would like to access data from other apps", which blocked `op` and wasn't remembered when
denied; service accounts never need the desktop app. It also stops any `op` command other
than `op run` after `OP_AG_TIMEOUT` seconds (default 120). To restore a token on a new ag, pipe it from the
recovery item into `security -i` running in the GUI session (an
`add-generic-password -U -a natkoersch -s "<service>" -w ...` line on stdin),
never as a command-line argument. Nathan's personal 1Password account holds
everything else (banking, investments, identity, recovery codes); agents must
not use it, and it is not signed in on ag (app or Chrome extension); sign it in
only on client machines.

After `~/.zshenv.local` exists, run `tfy-env` (or log out and back in) and
restart ChatGPT desktop: the stowed Codex config routes it through TrueFoundry.

## Remote Herdr

**Every machine (host and clients): Tailscale must launch at login.** In
Tailscale → Settings, turn on **Launch Tailscale at login** (check with
`defaults read io.tailscale.ipn.macsys TailscaleStartOnLogin` → `1`). If it's
off, a reboot or relogin leaves the machine off the tailnet and `ag`/`ssh` time
out in both directions. Enabled on nathan-dev-client 2026-09-28.

On the remote Mac: enable Remote Login (`sudo systemsetup -setremotelogin on`),
sign in to Tailscale, and list it as a host in `machines/README.md` so
dotfiles' `bootstrap --macos` keeps sleep off (clients sleep normally). From here,
`ssh-copy-id nathan@<host>`, then either:

- `ssh nathan@<host>` + `herdr`: runs entirely remote, like tmux.
- `herdr machine add nathan@<host> --label <host>`: shows it in the sidebar
  next to Local; drive it with `herdr --machine <host> ...`.

Remote agents use that machine's repos and secrets.

## Agent skills

User skills live in `agents/dot-agents/skills/<skill>/SKILL.md`. Stowing the `agents` package symlinks them into `~/.agents/skills/<skill>/SKILL.md`, which is what pi (and other tools) load via `settings.json` (`"skills": ["~/.agents/skills"]`).

`settings.json` also points at `~/arcade.school/.agents/skills` so the arcade repo's skills (`/skill:arcade-*`) are available from any cwd. This is the main checkout only, not worktrees; those skills assume you `cd` into a checkout before running repo commands.

Codex system skills live alongside under `agents/dot-agents/.system/` and stow to `~/.agents/.system/`.

## Global agent instructions

Pi, Claude Code, and Codex all load one file, `pi/dot-pi/agent/AGENTS.md` (the `claude` and `codex` packages symlink to it). That file is generated: edit the sources in `agents.md/` and run `agents.md/build`. Each top-level section is its own file in `agents.md/sections/`, concatenated in filename order (`010-…`, `020-…`; renumber to reorder); a line `<!-- include: NAME.md -->` pulls in a longer doc from `agents.md/includes/` with its headings nested. `install` rebuilds it, and a pre-commit hook rejects a stale build.

[`agents.md/includes/attribution.md`](agents.md/includes/attribution.md) is the single source of truth for how AI assistants label what they write for other people. Other repos (e.g. arcade.school's README) link to it rather than keeping a copy.

## Pi config

Pi extensions and non-secret settings are tracked in `pi/dot-pi`.

Live paths resolve like this:
- `~/.pi/agent/extensions/*.ts` -> `~/ag/pi/dot-pi/agent/extensions/*.ts`
- `~/.pi/agent/settings.json` -> `~/ag/pi/dot-pi/agent/settings.json`

Pi's default model and Ctrl+P rotation are configured only in `settings.json`
(`defaultProvider`/`defaultModel`/`enabledModels`); nothing in the shell
config overrides them.

Intentionally not tracked in git:
- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
- repo-local `.pi/todos/`

## Private chat (OpenRouter)

`ag-private` is a private chat page for personal questions: `http://ag:7375/` (or `http://100.107.192.32:7375/`), Tailscale only. Unlike everything else on ag, its inference goes straight to OpenRouter on Nathan's **personal** account, never TrueFoundry, Jev, or the ag inbox.

- Key: `OPENROUTER_API_KEY` in `~/.zshenv.local` (personal OpenRouter account, paid with Nathan's personal card). pi's `openrouter` provider in `models.json` reads the same variable. Without it the page answers "OPENROUTER_API_KEY isn't set on ag yet."
- Every request sends `provider: {data_collection: "deny", zdr: true}` (no provider training or retention). In the OpenRouter account settings, keep prompt logging off.
- Chats are stored only on ag in `~/private-chat/<id>.json` (dir 0700, files 0600); nothing about their content is logged. Model picker: Claude Opus 5.5 (default), GPT-6 Sol, Gemini 3.8 Flash (`MODELS` in the script; only models with a zero-data-retention endpoint work, e.g. Claude Fable has none).
- Phone: Back Tap triple tap → shortcut **Private ag** (`ios-shortcuts/private-ag.md`).
- Code: `bin/dot-local/bin/ag-private`; LaunchAgent `com.nathan.ag-private` (only runs on ag). Server output: `/tmp/ag-private.log`. Restart: `launchctl kickstart -k gui/$(id -u)/com.nathan.ag-private`.

## AG Dash (agent Kanban)

**AG Dash** (`ag-board`) is a Kanban dashboard over every agent session in Herdr: **https://ag.tail44736d.ts.net:7377/** (Tailscale only; `http://ag:7376/` redirects there, since browsers only allow the microphone on https). Herdr stays the runtime; the board is a view on it plus a little metadata Herdr doesn't keep.

- **iPhone app:** with Tailscale connected on the phone, open the https URL in Safari → Share → **Add to Home Screen** (keep "Open as Web App" on). It launches full-screen as "AG Dash" with the AG logo icon (a slanted green seven-segment "AG", also in the board header): `manifest.json` (standalone, PNG 192/512 icons) plus Apple meta tags (`apple-touch-icon` 180 px PNG, since iOS ignores SVG icons; `black-translucent` status bar), `viewport-fit=cover` with `env(safe-area-inset-*)` padding, a non-sticky header on narrow screens, and the SSE stream reconnects whenever the app comes back to the foreground. Icons are the logo on a dark tile: `icon.svg` is the source (rounded corners, used as the favicon); the PNGs are the same art rendered full-bleed with Playwright (iOS rounds the corners).
- **Cards:** one per Herdr tab hosting an agent: title, workspace, state and how long it's been in it, model, cost, thumbnails of any images/videos in the latest prompt or answer, and a **live activity line** while it works: a spinner with the tool and command it's running (amber after 3 minutes, which usually means something hung), bouncing dots while it's thinking, amber "waiting on you" when a dialog is up, red "stopped" after an interrupt or error. The preview is the latest prompt while working, else the answer's last paragraph.
- **🔥 Hotpath (top priority):** shift+click a card, long-press on the phone, or `f`. Hotpath cards are red and pin to the top of every column. Whenever a hotpath agent isn't working (done, idle or blocked) its card runs a **siren**: a bright segment orbiting its rim (a conic-gradient spun by a registered `@property` angle and masked to the border, after the arcade's `animate-laser-orbit`; reduced motion gets a steady red rim). When it becomes ready with something new, the fast lane fires: `ag-text` (with a link straight to the card) plus a Herdr toast; the open page also beeps. At most one ping per card per minute; opening the card marks it seen (the siren keeps running until the agent works again or you drop the hotpath).
- **⏳ Waiting for:** a session with a live tickler item (a wake-up waiting on CI / a check / an event, a presence item, a scheduled time, or a GTD waiting-for on a person; matched by the item's session file) sits in its own **Waiting for** column with a calm **blue** orbit instead of the red siren. It isn't "needs you" and never pings; the card shows what it's waiting on (details: the check command, person, or due time). `w` (or ⏳ in the details/drawer) marks any card waiting by hand. **Waiting always wakes up** (AGENTS.md → GTD model): a hand-set wait makes the board prompt that session, once it's at its prompt, to schedule its own tickler wake-up at an interval it chooses; until the item exists the card is flagged amber **⚠ no wake-up yet** (plus a header count) and re-asked up to 3 times, 15 minutes apart. The tickler item then takes over and the hand-set flag drops; giving the session new work also clears it. A blocked dialog still shows as Needs you.
- **▾ Details** (per card, or "Details" for all): latest prompt, the current turn's thinking, latest answer, the last 6 tools with ✓/✗/running and durations, and stats (cost, context, prompts, tool calls, thinking level, cwd, age).
- **Every page is a URL**, so the browser's back/forward (and phone swipe-back) walk through them: `/state`, `/lists`, `/workspaces` (`/` opens your last view), a column on the phone (`/state/waiting`, `/lists/now`), a session (`/<session id>`, its live screen `/<session id>/live`), a card with no pi session (`/t/<tab id>`), and the dialogs (`/new`, `/help`).
- **Deep links:** `http://ag:7376/<pi session id>` (what `herdr-link` and `session-link` print) opens the board with that session: the live card's drawer, or for a hibernated pane its transcript with **Wake in Herdr** (focusing wakes it), or for a closed session its transcript with **Resume** (a new Inbox tab running `pi --session <file>`). Opening any card puts its link in the address bar; 🔗 copies it.
- **Drawer** (click a card): Transcript (prompts, answers, collapsible thinking and tool calls with arguments and results, and **images and videos** inline: screenshots embedded in the session, e.g. pasted images and `read`-tool images, plus image/video files mentioned by path; click a thumbnail for a full-size viewer), Live screen (the agent's terminal, refreshed every second, with keys for dialogs: Esc, Enter, arrows, Tab, y/n, 1–3; opens by default when the agent is blocked), Interrupt, Hotpath, Open in Herdr, Mark unread, list, 🗄 Archive. Click the title to rename the tab.
- **Prompt editor:** CodeMirror 6 (markdown highlighting, no vim). ⌘↩ sends; drafts are kept per session in the browser when you switch sessions or close the drawer; the editor clears at once and gets your text back if sending fails. **Dictate** (button or Alt+V) records in the browser; stopping it (the button again, or ⌘↩) **sends at once** with anything typed, and the board transcribes it in the background (Whisper on TrueFoundry; `POST /api/dictate`; if transcription fails the agent gets the recording's path). **Attach** or paste/drop adds files: saved to `~/inbox/clipboard/` and their paths go into the prompt.
- **Disrupting an agent:** ⏹ (or `x` twice) interrupts (Esc twice; this Pi setup asks for a second Esc). Replying while it works = **Steer**: queued, delivered after its current step. **Interrupt & send** stops it, waits until it's ready, clears whatever Pi put back in its editor (Ctrl+U), then sends your message instead.
- **+ New item** (or `n`; `d` opens it already dictating): type or dictate it; dropped files add their paths. It goes to the ag inbox (`?new=1`), which opens a new session in Inbox and names it; a dictated item is sent the moment you stop and transcribed by the inbox in the background.
- **🗄 Archive** (`e`, card details, or drawer): the card disappears at once with an **Undo** toast; the Herdr tab is closed only when the toast expires (6 s) or you leave the page, so Undo leaves the session untouched.
- **Views:** State (Needs you / Working / Waiting for / Parked / Resolved; click a column header to collapse it, Resolved starts collapsed), Lists (your own lists, edited under "Lists…"; drag cards between them), Workspaces, **Routines** (`/routines`, key 4: every recurring job Ag runs on its own, i.e. the session host's systemd timers and ag-mac's interval LaunchAgents, with schedule, last run and result, next run, the last run's own ✓/✗ summary, Run now and Log for engine routines; see "Routines" below).
- **Tool rows** (card activity, Recent tools, transcript): each call shows the machine it runs on (`ag-engine`, `ag-mac`, `ag-client`, `ag-phone`, `mcp`) and a deterministic one-line summary from `toolsum/` ("Telegram: Click "Open"", "Query production arcade DB: play_sessions"); when no rule fully covers a call it falls back to the raw command, which is always on hover. See `toolsum/README.md`. Search with `/` (works with a session open too); "Hot only" shows just hotpath cards.
- **Keyboard** (`?` shows all): j/k/h/l move, o/Enter open, Space details, f hotpath, w waiting, x x interrupt, e archive, g open in Herdr, u unread, n new item, d dictate a new item, / search (n, d and / also work with a session open), 1/2/3 views.
- **Needs you** = blocked, or ready with an answer newer than when you last saw it. Seen = opened on the board, replied from it, jumped to in Herdr, or the tab focused in Herdr. **Resolved** = the answer ends with a `DONE` line.
- **Click telemetry:** one delegated listener on the page logs every button/control click (a stable name from `data-t`, else `id`/`data-*` action/aria-label/title/text; plus desktop or phone view) with `navigator.sendBeacon` to `POST /api/click`, which appends `{ts, name, view}` to `~/.local/state/ag-board/clicks.jsonl`. `ag-dash-stats [days]` (or `GET /api/stats?days=N`) ranks controls by clicks. Nothing leaves ag.
- **State:** `~/.local/state/ag-board/state.json` (hotpath, list, waiting, seen time, status timing, lists), keyed by pi session id so flags survive the Inbox auto-filer moving a tab (tabs without a session fall back to the tab id). Entries for sessions no longer open are dropped.
- **How it works:** polls `herdr api snapshot` every 1.5 s, reads each Pi session file incrementally (only appended bytes), and pushes the board to open pages over SSE. Listens on ag's Tailscale IP and on 127.0.0.1; at startup it runs `tailscale serve --bg --https=7377 http://127.0.0.1:7376` (idempotent; tailscale serve can't reach ag's own Tailscale IP, hence the loopback listener). Media is served only for image/video files under `~` or `/tmp` (`/api/file`, with Range support) and for images inside session files (`/api/embedded`).
- Code: `bin/dot-local/bin/ag-board`; page: `ag-board/dot-local/share/ag-board/index.html` (+ `editor.js`, `manifest.json`, `icon.svg`, `icon-{180,192,512}.png`; page edits need only a refresh). The editor bundle is built from `ag-board-editor/` (`cd ag-board-editor && bun install && bun run build`) and committed, so machines don't build it. LaunchAgent `com.nathan.ag-board` (only runs on ag). Log: `/tmp/ag-board.log`. Restart after server edits: `launchctl kickstart -k gui/$(id -u)/com.nathan.ag-board`.


## Routines

A **routine** is a recurring job Ag runs on its own, on a schedule, without anyone asking (as opposed to a
tickler item, which wakes one session once). On the session host each routine is a systemd user timer in
`systemd-user/` (`<name>.timer` + `<name>.service`, enabled in `bootstrap-linux`); on ag-mac it's a LaunchAgent
with `StartInterval`/`StartCalendarInterval` in `macos-launchagents/` (put a one-line `<!-- … -->` description in
the plist). AG Dash → **Routines** lists them all. A routine reports what its last run did by writing
`~/.local/state/routines/<name>.json` (`{at, ok, summary, session?}`; `session` is a Pi session id, linked from
the card).

| routine | where | what |
|---|---|---|
| `tickler` | engine, every 60 s | fires due tickler items |
| `presence` | engine, every 30 s | is Nathan at his Mac |
| `pi-sessions-sync` | engine, hourly | archives Pi sessions to GitHub |
| `toolsum-review` | engine, daily 9am Central | extends AG Dash's tool-call summary rules (`toolsum/README.md`) |
| `mem-watch`, `nessie`, `chrome-tab-reaper` | ag-mac | memory alerts, Nessie trace sync, closing stale Chrome tabs |

## Nessie (agent-trace sync)

Directive: every agent trace paid for by the company (Joe Lamont) must sync to Nessie; only Nathan's personal OpenRouter usage must not. Nessie (`cask "nessie-app"`, nessielabs.com) runs on every machine, signed in as `nathaniel.koerschner@superbuilders.school`.

- **On ag-engine (session host, Linux):** headless, no app. `@nessielabs/daemon` (npm, `--prefix ~/.local`; installed by `bootstrap-linux`) provides `nessie-daemon`; systemd user unit `nessie.service` runs its `nera` runtime (host role only). Integrations Pi, Codex, Claude Code (`nessie-daemon integrations list`); automatic ingestion + cloud sync are on (`nessie-daemon run` turns them on; the setting persists). Signed in by device pairing: `nessie-daemon auth login --pair --no-open`, then in Nessie on ag-mac **Settings → Devices → Authorize** and enter the code (CUA can do it); login lives in `~/.local/share/nessie/` (0600, never print). Then `nessie-daemon integrations add pi` (and `codex`, `claude_code`). Check: `nessie-daemon status`. Docs: nessielabs.com/docs/nessie-daemon, /docs/linux-endpoint-client (the Linux desktop `.deb` needs a display; not used).
- **Integrations on ag:** Pi (`~/.pi`), Claude Code (`~/.claude`), Codex (`~/.codex`); local only, set in the app's onboarding. Web accounts (Claude.ai, ChatGPT, Perplexity) are connected on the client (nathan-dev-client), which also has Pi and Cursor; don't connect them twice. Check: `/Applications/Nessie.app/Contents/MacOS/nessie-cli status` and `nessie-cli transcript list --type pi`.
- **Sign-in on a new machine:** open Nessie and sign in, or copy `access_token.txt`, `refresh_token.txt`, `user_info.json`, `deployment-selection.json` from `~/Library/Application Support/Nessie/` on a signed-in machine (dir 0700, files 0600; never print them). Don't copy `device.json` or `notes.sqlite`: each machine registers as its own device. Then finish onboarding in the app and connect the local integrations.
- **Kept running** by LaunchAgent `com.nathan.nessie` (opens it at login and every 5 min if it isn't running).
- **Stalled but running:** the LaunchAgent can't see a hung app. On 2026-09-28 the client's Nessie 1.4.4148 sat on an update dialog and hadn't synced since Sep 23; installing the update fixed it. Check `lastSyncedAt` in `notes.sqlite`'s `integration` table (read-only), since `nessie-cli` can't reach the app over SSH.
- **Stalls:** Nessie can keep running but stop picking up new sessions (seen on ag 2026-09-28: nothing new after 02:43 until a restart). If `nessie-cli status` shows `ingested`/`synced` hours old while agents are active, or a current session is missing from `nessie-cli transcript list --type pi`, quit and reopen the app (`osascript -e 'quit app "Nessie"'; open -g -a Nessie`); it catches up within a few minutes.
- **OpenRouter stays out.** Nessie can't filter by provider; it syncs everything under its base paths. So OpenRouter never writes there: `ag-private` keeps chats in `~/private-chat`; pi on OpenRouter runs only through `pi-private` (sessions in `~/private-chat/pi-sessions`); the `nessie-openrouter-guard` pi extension reverts any `openrouter` model picked in a session under `~/.pi` to Opus 5.5 on TrueFoundry. The 113 older pi sessions (May–July 2026) that used OpenRouter were moved from `~/.pi/agent/sessions` to `~/private-chat/pi-sessions/` before Nessie first scanned (list: `.moved-from-pi-sessions.txt` there). If one slips in, delete it in the Nessie app ("exclude from future syncs").

## ag inbox

The ag inbox (`ag-inbox`) is the top-level endpoint that starts a new session: POST a prompt and ag opens a new Herdr tab running pi with it as the first prompt. Every capture path goes through it: the Mac quick capture, the iPhone Action Button, and file-inbox's "New session".

- Test page: http://ag:7373/ (or `http://100.107.192.32:7373/`). Tailscale only; it listens on ag's Tailscale IP.
- API: `curl -X POST http://ag:7373/prompt -d 'your prompt'` → `202`, no body. Form posts take `text` and an optional `id`; a repeated `id` within 24 hours is acknowledged without opening a second tab (so the phone's offline queue can resend safely).
- Screenshots: a multipart form can add `screenshot` (image file) plus `app`/`window` (frontmost app and window title). It's saved to `~/inbox/capture/`, and Jev (via TrueFoundry) judges from the prompt and window context whether the agent needs it (attached when P ≥ 0.5, or if Jev fails). `attach=always` skips Jev. Attached means the prompt ends with the file path for pi to read.
- **Mac quick capture: Cmd+Shift+Space** (Hammerspoon, `hammerspoon/dot-hammerspoon/ag_inbox.lua`). Snapshots the screen with the focused window, then opens a small prompt form: Enter sends, Shift+Enter is a newline, Esc cancels. Click the thumbnail to annotate in CleanShot; its Cmd+S saves over the file and the form shows the annotated version, which is always attached. The form is a webview built once at load and only shown/hidden, so it opens in ~0.1–0.2 s, most of it the screenshot. Upload runs in the background with `curl`; on failure an alert shows and the prompt is copied to the clipboard. Needs Screen Recording permission for Hammerspoon (without it, captures are text-only).
- iPhone screenshots: the Action Button capture sends `screenshot` plus `source=iphone`, and Jev gets a phone-specific question (no app/window context).
- Shared files and links (iPhone share sheet, `ios-shortcuts/share-to-ag.md`): `file` (repeatable) is always attached, saved to `~/inbox/share/` (HEIC and other formats pi can't read are converted to JPEG); `url`/`shared` carry a shared link or text. With files or a link, `text` may be empty, and the agent is told to work out what's most likely wanted.
- **Follow-ons go to their thread.** In parallel with routing, Jev checks whether the capture is new context for something already open ("the thing I was calling study film…", "for the consent sankey, also…"). One request, two questions over `{new_message}`: a `noul` (does it refer back to ongoing work?) and a `choice` over every open pi session (one per tab, described as `Workspace › Tab` plus its first and latest prompt, read from the pi session file) plus `none`. Ongoing ≥ 0.7 and match ≥ 0.8: the capture (after the screenshot gate) is prompted straight into that session, prefixed as inbox context, and a Herdr toast names it; no new tab. Ongoing ≥ 0.5 and match ≥ 0.3: a new Inbox session opens as usual, but its prompt names the likely session and how to forward it once Nathan confirms. Otherwise, or on a Jev failure, a playbook match, or a session blocked on a dialog: a normal new session. Adds ~0.6 s. Clear follow-ups score 0.97–1.0; a vague "any update on that thing?" ~0.6 (→ hint). Log step `thread` (action, `ongoing`, `p`, tab), then `followed` or `follow_failed`; tune the thresholds (`FOLLOW`/`HINT` in `ag-inbox`) from it.
- Otherwise every capture opens a tab in the **Inbox** workspace (created if missing). A fast multimodal model (TrueFoundry Gemini Flash Lite; it sees shared images, not the Jev-gated screenshot) names the tab and picks a playbook. Nothing is focused, so attached clients aren't disturbed.
- **Playbooks** (`ag-inbox/dot-config/ag-inbox/playbooks/*.md` → `~/.config/ag-inbox/playbooks/`, re-read on every request): set workflows for typical kinds of captures. Each is a Markdown file with frontmatter `name` and `when` (what the router matches on); its body is prepended to the prompt when matched. Add a file to add a workflow; no restart needed. Current: `contact` (a name + phone/email, or a contact card/business card image → look them up, add to Contacts, message them as Nathan, drafting for his OK unless he said what to send). Contacts run on the client Mac via `client-people` (`find`/`add`/`text`), since ag-mac's Contacts sync isn't reliable. **Messages work on ag-mac**: it's signed in to iMessage (nathankoerschner@gmail.com) with iCloud sync, so `ag-messages` (skill `imessage`) lists recent/unread chats, reads any thread including group chats, searches, resolves contacts by name, fetches attachments, and sends text and files as Nathan (reporting delivery). Never read Messages through the client's desktop.
- Dry run: form field `dry=1` routes and gates only and returns `{label, playbook, thread, prompt}` as JSON, opening nothing (`thread` = the follow-on decision).
- Inbox is pinned first in the sidebar (`herdr/plugins/pin-inbox`), and sessions file themselves: on your first reply (the 2nd prompt a pi process sees), `pi/dot-pi/agent/extensions/herdr-inbox-file.ts` has a fast model pick an existing topic workspace from workspace and tab names, then moves the pane into a new tab there (focus follows if you're looking at it, otherwise a Herdr toast). If nothing fits, it stays in Inbox. Log: `~/.local/state/herdr-inbox-file/log.jsonl`.
- Code: `bin/dot-local/bin/ag-inbox`; LaunchAgent: `com.nathan.ag-inbox` (only runs on ag).
- Log: `~/.local/state/ag-inbox/log.jsonl`, one line per step (`received → screenshot → routed → tab → pi_started → sent`, or `route_failed`/`jev_failed`/`duplicate`/`failed`). Server output: `/tmp/ag-inbox.log`.
- Restart after edits: `launchctl kickstart -k gui/$(id -u)/com.nathan.ag-inbox`.
- Voice: a multipart `audio` field (or a queued audio file sent as `text`) is saved to `~/inbox/capture/` and transcribed with Whisper via TrueFoundry (`whisper-1`, falling back to `openai-esw/whisper-1`); the transcript is the prompt (log step `transcribed`, or `stt_failed`, in which case the agent gets the file path).
- iPhone Action Button capture (Voice to ag on the Action Button, Capture to ag (text only) on the Home Screen; voice attaches a screenshot): `ios-shortcuts/capture-to-ag.md`. iPhone share sheet: `ios-shortcuts/share-to-ag.md`.

## Tickler (deferred tasks)

GTD tickler for Herdr. Say it in plain text to any pi agent ("do X Friday at 9", "send this back to me in two weeks"); the agent calls the `tickler` tool. At that time a new tab `⏰ <title>` opens in the same Herdr workspace (falls back to `Inbox`), running pi **forked from the conversation that deferred it**, with the task as its first prompt. Nothing is focused; a Herdr notification fires.

- Tool: `pi/dot-pi/agent/extensions/tickler.ts` (schedule / list / cancel). CLI: `bin/dot-local/bin/tickler add|list|cancel|trigger|fire`.
- LaunchAgent `com.nathan.tickler` runs `tickler fire` every 60s, only on ag (the host). Items missed while asleep fire on wake and say they're late.
- State: `~/.local/state/tickler/<id>.json`; log `log.jsonl` beside them (`added → fired`, or `failed` with the error). launchd output: `/tmp/tickler.log`.
- **Waiting for** (GTD): when an agent is waiting on another person, it schedules `waitingFor: "<name>"` + `at` (CLI `tickler add --at … --waiting-for <name> [--attempt N] [--check '<sh>']`). At check-in (`⏳ <title>`, or early if `--check` passes, e.g. a DNS change) the agent checks for their reply: replied → next step; gave a timeline → requeue after it; silent → one friendly follow-up, requeue with backoff (1 → +2d → +4d → +1w), then stop and ask Nathan. Resumes the deferring session in place when it's open.
- **Presence trigger** ("resume this next time I'm on the client"): the agent schedules with `when: "online"` instead of a time (CLI `tickler add --when online …`). It opens as `🟢 <title>` on Nathan's next arrival at the client after it was queued, once. Uses `presence` below.
- **Wake-ups** (an agent waiting on something slow: a machine coming back, CI, a deploy): `when: "check"` with a shell `check` (CLI `tickler add --when check --check '<cmd>' …`) is run by the every-minute LaunchAgent with no model (20s cap) and fires once it exits 0; `when: "event"` fires only via the webhook `POST http://ag:7373/tickler/<id>` (served by `ag-inbox`; optional body = note) or `tickler trigger <id>`. Both resume the deferring pi session **in place** (`herdr agent prompt` to the pane whose session matches, if idle/done), else open a forked `🔔 <title>` tab. After `--expires` (default 7 days) they fire anyway and say the condition never came true.

## Presence ("Nathan is online")

`presence` on ag answers "is Nathan actually at the client Mac right now?" Run `presence` (one line) or `presence status --json`.

- **How:** LaunchAgent `com.nathan.presence` runs `presence poll` every 30s, only on ag. One SSH call to the client (`$PRESENCE_CLIENT`, default `nathan-dev-client`; ControlMaster keeps it ~0.2s) reads HID idle time (real keyboard/mouse/trackpad input), `IOConsoleLocked`, and the console user. Nothing runs on the client, so there's no client setup; a sleeping client just stops answering.
- **Debounce:** **online** after ≥ 90s of continuous activity (input within the last minute, unlocked), so a brief wake doesn't count. **Offline** when locked, unreachable 3 polls in a row (asleep / off Tailscale), or no input for 15 min. Short idle stretches (reading) stay online. While a `client-cua` job runs on the client, its synthetic input is ignored (state held, arrival streak reset).
- **Arrival:** on each offline → online transition it runs `tickler fire`, which launches the `when online` items queued before that arrival (plus the every-minute backstop). `tickler fire` takes a lock so the two runs can't double-fire.
- State: `~/.local/state/presence/state.json` (`state`, `online_since`, `last_seen`, `idle_s`, …); transitions in `log.jsonl` beside it. launchd output: `/tmp/presence.log`. State older than 5 min reads as `unknown` (poller not running).
- Not detected: Nathan on the phone only, or at a client not in `machines/README.md`. Jump Desktop input from ag into the client would count as presence.

## Activity capture (time review)

Metadata only, for reviewing where Nathan's time and effort go. Nothing polls on its own: client events are event-driven, and ag piggybacks on the presence poll. Everything is JSONL in `~/.local/state/activity/` on ag.

| File (on ag) | Written by | What |
| --- | --- | --- |
| `client-<client>.jsonl` | client Hammerspoon `activity_log.lua` → pulled by `presence poll` | `hs_start` (login/reload, with boot time), `lock`/`unlock`, `sleep`/`wake`, `screens_off`/`on`, `session_active`/`inactive`, `power_off`, `screensaver_on`/`off`, `app_launch`/`app_quit`/`app_front` (app, bundle id, front window title ≤160 chars) |
| `ag.jsonl` | `presence poll` (one `ps` per poll; `lsof` + `tailscale status` only for a new process) | `herdr_attach`/`herdr_detach`: which device has Herdr attached (`bridge` = the client's `ag` command, `tui` = Herdr in an SSH/mosh terminal such as Moshi, or ag's local Ghostty), with Tailscale IP → device name |
| `injections.jsonl` | `ag-inbox`, `tickler`, `file-inbox` | a 12-char SHA-1 of every prompt they inject with `herdr agent prompt`, plus their id |
| `prompts.jsonl` | Pi extension `activity-log.ts` | one line per prompt: session file, cwd, Herdr IDs at session start, `origin` (`typed` / `ag-inbox` / `tickler` / `file-inbox` / `rpc` / `extension`, by matching the injection hash), attached devices, client presence and HID idle seconds. No prompt text (the session file has it). Private sessions (`pi-private`, `~/private-chat`) are skipped. |
| `state.json` | `presence poll` | pull offset into the client log, currently attached Herdr clients |

The ag inbox also logs `from` on each `received` capture in `~/.local/state/ag-inbox/log.jsonl`: requester IP (Tailscale device), declared `source` (`iphone`), the Mac's front app/window, and user agent.

- The client keeps its own `~/.local/state/activity/events.jsonl`; ag copies new complete lines each poll (≤256 KB per poll) and restarts from 0 if the client file shrinks. While the client is asleep, events queue there and arrive on the next poll.
- Limits: Herdr doesn't say which attached client typed a keystroke, so `typed` prompts carry the attached devices plus the client's idle time. A prompt one agent sends to another with `herdr agent prompt` also reads as `typed`; a large client idle time with no phone attached marks it as probably not Nathan. Window titles only update when the app changes (switching tabs inside one app isn't logged).

## Jev (TypeSafe System One model)

Guide for agents. Sources: [docs.typesafe.ai](https://docs.typesafe.ai/llms.txt) (source of truth; append `.md` to any page path) and the official skill, vendored at `agents/dot-agents/skills/typesafe-ai` (from [typesafe-ai/skills](https://github.com/typesafe-ai/skills)). Read the live docs before writing an integration; details below are from jev-1.13 (Sep 2026).

**What it is.** A fast decision model, not a chat LLM. You send a `state` (text, JSON object, or array) plus named typed questions; it returns typed answers with calibrated probabilities. It does not generate text, call tools, or write code, so it can't power pi or any coding agent. Use it *inside* code wherever the answer has a known shape: route, gate, score, verify.

**Split the work.** If the step creates text or plans, keep it on an LLM. If it picks from a list, scores on a rubric, or answers yes/no, use Jev. Keep exact rules, lookups, and execution in plain code.

**API.**

```bash
# Through our TrueFoundry gateway (use this; no TypeSafe key needed). The path after
# /proxy-api/jev-account/jev-endpoint/ is passed straight through to api.typesafe.ai.
curl -s https://tfy.promptlens.trilogy.com/proxy-api/jev-account/jev-endpoint/v1/systemone \
  -H "Authorization: Bearer $TFY_TOKEN" -H 'content-type: application/json' \
  -d '{"model":"jev-latest","state":"Help! My payouts have been failing for 3 days.",
       "questions":{
         "team":{"type":"choice","instructions":"Which team should handle this?",
                 "criteria":{"billing":"Payments, refunds","technical":"Bugs, outages","sales":"Pricing, upgrades"}},
         "urgent":{"type":"noul","instructions":"Does this convey urgency?"},
         "anger":{"type":"score","instructions":"How frustrated is the customer?","criteria":["Calm","Frustrated","Very angry"]}}}'
```

| Primitive | Use for | Answer |
|---|---|---|
| `choice` | one option from a set (≤255 options in `criteria` map) | `choice`, `probabilities`, `confidence` |
| `noul` | whether a condition holds | `noul` = P(yes), 0–1 |
| `score` | degree on ordered levels (2–10 in `criteria` array) | `score` (can fall between levels), `probabilities`, `confidence` |

- Question ids are for your code only and are never sent to the model, so each question must be self-contained. Point at nested state with backticked paths like `` `ticket.messages[0].text` ``.
- Ask all independent questions over the same state in **one request**. They run in parallel, and extra speculative ones are cheap. Only make a second call when an earlier answer is needed to build the next state.
- Include a no-match option when nothing may fit. Gate actions on `confidence` or probability thresholds tuned on your own data; route the uncertain ones to a person or a reasoning LLM. A `noul` near 0.5 means "unsure", not "medium".
- Models: `jev-latest` (currently `jev-1.13.0`); pin the versioned id if you tuned thresholds. 64k tokens per request (32k for state plus the longest question), text only, English is strongest. Priced per input token (about $0.042 per million); output is free. It returns `429` when rate-limited, so retry with backoff.
- SDKs: Python (`TypeSafeClient` / `AsyncTypeSafeClient`) and JavaScript; see [SDKs](https://docs.typesafe.ai/sdk.md). Try prompts in the [Playground](https://console.typesafe.ai/playground).
- Access: call Jev through TrueFoundry as above with `TFY_TOKEN` (from `~/.zshenv.local`), not `api.typesafe.ai` directly. It is a TrueFoundry "custom endpoint", so `/chat/completions` rejects it; use the `/proxy-api/` path. TypeSafe SDKs can point at that base URL.
- In use here:
  - `pi/dot-pi/agent/extensions/herdr-tab-name.ts`: keeps Herdr tab names accurate (`noul`: does the label still fit the recent prompts?; see Herdr config).
  - `ag-inbox` screenshot gate: `noul`, does the capture need the screenshot? (see "ag inbox").
  - `ag-inbox` follow-on routing: `noul` (refers to ongoing work?) + `choice` over open sessions and `none`, to deliver a capture into the session it continues (see "ag inbox"). A worked example of the "pick from a list with a no-match option" pattern; with 60+ options, including each session's latest prompt noticeably raised the right answer's probability.

## Moshi (iPhone terminal)

Moshi on the iPhone connects to ag over Tailscale and attaches to Herdr.

- **Hook daemon**: `install` runs `moshi-hook-install`. It installs the
  checksum-verified prebuilt `moshi-hook` into `~/.local/bin`, because the
  Homebrew formula refuses to install when the Command Line Tools lag behind macOS.
  The daemon runs from `macos-launchagents/com.nathan.moshi-hook.plist`
  (`brew services` isn't used). Check it with `moshi-hook doctor`.
- **Agent hooks**: `install` sets up the Pi hook only
  (`~/.pi/agent/extensions/moshi-hooks.ts`, generated, untracked).
  `moshi-hook install --target claude,codex` replaces the stowed
  `settings.json`/`hooks.json` symlinks with real files containing
  host-specific paths. If you run it, move the Moshi entries into the
  repo files and restore the symlinks.
- **Pairing** (by hand, once per host): Moshi app → Settings → Hooks →
  select ag → Retry/Pair, or run `moshi-hook host setup` and scan the QR code.
  The host secret stays in the login Keychain (`app.getmoshi.hook`), not in this repo.
- **Session deep links**: `session-link` prints the session's AG Dash link for the phone,
  `https://ag.tail44736d.ts.net:7377/<pi session id>` (full name + https so iMessage linkifies it).
  The board's drawer has a **📱 Moshi** button on touch devices: `http://<ag>:7374/m/<pi session id>`,
  where `file-inbox` resolves the session's current pane (it survives the Inbox auto-filer)
  and 302s to `moshi://herdr?workspace=…&tab=…&pane=…`, which resumes Moshi's
  already-open ag card on that pane (Moshi can't open a new connection from a link).
  The http hop exists because iMessage doesn't linkify `moshi://`.
- **Phone texts when agents finish**: `pi/dot-pi/agent/extensions/ag-notify.ts` texts
  `✅ Done` or `⚠️ Attention needed` + tab name, a one-line "what happened / what to do"
  headline (fast LLM), and the `session-link`, when a turn ends while Nathan is away
  (`presence`) or after a turn of 2+ minutes. `AG_NOTIFY=always|off` overrides per session.
  Sent by `ag-text`: Telegram bot "ag" (@nathan_ag_bot) if Keychain items `ag telegram bot`
  (token) and `ag telegram chat` (chat id) exist, else `~/.config/ag/telegram` (0600,
  `token=`/`chat=`; what ag-engine and ag-mac use, since ag-mac's Keychain is locked over SSH),
  else iMessage from the client Mac (needs it awake). Recovery copy: `op-shared` item
  `ag telegram bot` (token + chat id). Telegram tasks (BotFather, reading chats) run in
  **Telegram.app on ag-mac**, which must stay signed in to Nathan's account; if it shows the
  QR login screen, Nathan scans it once from his phone (Telegram → Settings → Devices →
  Link Desktop Device). Never drive the client's Telegram or iPhone Mirroring for this.
  Log: `~/.local/state/ag-notify/log.jsonl`.
- **Shortcuts**: the same Herdr shortcuts as the Mac, per
  [`herdr/SHORTCUTS.md`](herdr/SHORTCUTS.md). Moshi forwards Cmd keys to Herdr,
  except Cmd+N/W/O/K/V/1–9, which it keeps for itself; use `Ctrl+B` + key for those.
- **Line breaks**: Shift+Tab inserts a newline in Pi (Moshi's Shift+Enter arrives
  as plain Enter). Set in `pi/dot-pi/agent/keybindings.json`, so it applies on every
  client; thinking-level cycling moved from Shift+Tab to Alt+T. Open Pi sessions need `/reload`.

## Herdr config

Tab names stay accurate on their own (`pi/dot-pi/agent/extensions/herdr-tab-name.ts`). On every prompt, in the background: a default numeric tab gets named by a fast LLM; otherwise Jev scores whether the label still fits the last 3 prompts, and if P(accurate) < 0.6 the LLM renames it. Renaming a tab by hand pins it for that session. Decisions are logged to `~/.local/state/herdr-tab-name/log.jsonl` (label, `p_accurate`, keep/rename) for tuning the threshold. Open pi sessions need `/reload` to pick up changes.

`herdr/dot-config/herdr/config.toml` stows to `~/.config/herdr/config.toml`.
Only config, plugins, and agent integrations are tracked; Herdr's sockets, logs,
`session.json`, and `plugins.json` stay local. Apply config changes with
`herdr server reload-config`.

- `herdr/plugins/`: `recent-agents` (sidebar Agents sorted newest state change
  first), `tab-bubbles` (● on a tab per agent that finished or needs input
  while you weren't looking; visiting clears it), and `pin-inbox` (keeps the
  Inbox workspace first).
- Panes can move between workspaces (Inbox auto-filing), so `HERDR_TAB_ID` and
  `HERDR_WORKSPACE_ID` can go stale; `HERDR_PANE_ID` stays valid (Herdr aliases
  it). Resolve the live location with `herdr pane get "$HERDR_PANE_ID"`.
- Agent integrations (`herdr integration install <agent>` output) are stowed
  from `pi/`, `claude/` (`hooks/` + `settings.json` hook), and `codex/`
  (`herdr-agent-state.sh`, `hooks.json`).
- After stowing on a new machine, run `herdr/setup.sh` to register the plugins.
- Shortcuts: canonical list and per-device behavior in
  [`herdr/SHORTCUTS.md`](herdr/SHORTCUTS.md) (spec `shortcuts.json`, verified by
  `herdr-shortcuts-check`).

## Memory watch

`bin/dot-local/bin/mem-watch` (LaunchAgent `com.nathan.mem-watch`, every 5 min, all
machines) logs a memory sample to `~/Library/Logs/mem-watch.log` and notifies Nathan
(at most hourly per alert) when macOS memory pressure is warn/critical, swap in use
is >= 8 GB, or a single process holds >= 3 GB. Alerts from the host go to the
client's notifications (over SSH) plus a Herdr toast. Run `mem-watch` for a status
table of every machine. Thresholds: `MEMWATCH_SWAP_GB`, `MEMWATCH_PROC_GB`.

## Pi session hibernation

Idle pi sessions cost ~100-200 MB each, and dozens stay open as GTD items. Like
Chrome's tab discarding, `bin/dot-local/bin/pi-hibernate` (LaunchAgent
`com.nathan.pi-hibernate`, KeepAlive, only on ag) stops idle ones and wakes them on
demand: every 10 min it hibernates pi panes whose Herdr state is `idle` (`done` keeps
its badge), that aren't focused or in the Inbox workspace, whose session file is
unchanged for 2 h (30 min under macOS memory pressure), and whose pi has no child
processes besides MCP helpers. The pane then shows a sleep screen; focusing the pane
(the daemon watches Herdr focus events) or pressing any key runs
`pi --session <file>`, restoring the full conversation. Ctrl+C on the sleep screen
drops to a shell. Manual: `pi-hibernate sweep [-n] [--all]`, `pi-hibernate pane <id>`,
`pi-hibernate status`. Thresholds: `PI_HIBERNATE_IDLE_MIN`,
`PI_HIBERNATE_PRESSURE_IDLE_MIN`. Log: `~/.local/state/pi-hibernate/log`. Scrollback
and in-flight process state don't survive; the conversation does.

**Chrome on ag** (agents leave tabs open): Memory Saver is ON at **Maximum**
(chrome://settings/performance, GUI-only; set 2026-09-28), so inactive tabs are unloaded.
`bin/dot-local/bin/chrome-tab-reaper` (LaunchAgent `com.nathan.chrome-tab-reaper`, every
30 min, only on ag) closes tabs that haven't been the active tab of their window for 12 h
(`CHROME_TAB_REAPER_HOURS`); never a window's active or last tab. `chrome-tab-reaper
status` shows ages, `chrome-tab-reaper log` lists closed URLs. Apple Events from
LaunchAgents hang without a grant, so sweeps run through `~/Applications/ChromeTabReaper.app`
(built by `macos-apps/ChromeTabReaper/install.sh` in `install`). **After a fresh build,
grant it:** run `chrome-tab-reaper sweep` and click Allow on "ChromeTabReaper wants access
to control Google Chrome" (System Settings → Privacy & Security → Automation). The
prompt lives in UserNotificationCenter, which CUA can't touch; Hammerspoon can press it
via `hs.axuielement`. ag also allows `sshd-keygen-wrapper` → Google Chrome, so scripts
run from Herdr/pi (started over SSH) can drive Chrome with osascript.

## Pi sessions archive

`pi-sessions-sync` copies every Pi session transcript to Nathan's private GitHub: repos
`koerschner/pi-sessions-NNN` ("volumes"), laid out as `machines/<machine>/<project>/<session>.jsonl`.
Design notes: `docs/ag.md` ("pi-sessions archive").

- **Redacted, then encrypted.** Token and key patterns, payment cards (issuer prefix + Luhn) and
  `key = "value"` secrets become `[REDACTED:<kind>]`, then git-crypt encrypts everything under `machines/`.
  The key is base64 in 1Password, ag-vault "pi-sessions git-crypt key". To read the archive:
  clone it, `op-work item get "pi-sessions git-crypt key" --vault ag-vault --fields password --reveal | base64 -d > key`,
  then `git-crypt unlock key`.
- **When:** hourly, only for sessions untouched for 60 minutes (a live session is archived once it
  settles, then again whenever it changes). On the host, LaunchAgent `com.nathan.pi-sessions-sync`
  archives ag-mac plus the client, pulled over SSH (the client holds no vault credentials). On Ag Linux
  machines, the `pi-sessions-sync.timer` systemd user unit archives that machine. Log on ag: `/tmp/pi-sessions-sync.log`.
- **Volumes:** at about 4 GB a new private volume is created and the old one archived. The newest
  volume holding a file has its latest version. Pushes go in batches of about 400 MB.
- **State** (clones, index, remote mirrors): `~/.local/state/pi-sessions/`, on the engine's /data volume.
- **Separate from Nessie,** which syncs company-paid traces to the company. OpenRouter sessions under
  `~/private-chat` aren't archived.

## Shared MCP gateway (Pi)

Pi's stdio MCP bridges (`linear`, `arcade_school`, `honeycomb`, `tsa_courses`) run
**once per machine** instead of once per Pi session: `bin/dot-local/bin/mcp-gateway`
(LaunchAgent `com.nathan.mcp-gateway`, KeepAlive, all machines) runs each server's
`mcp-remote` behind its own pinned `mcp-proxy` (via `uvx`) on
`127.0.0.1:7381`–`7385/mcp`, and `pi/dot-pi/agent/mcp.json` points at those URLs
(`slack` stays direct HTTP). Per-session bridges cost ~100 MB each (96 sessions used
~9.5 GB on ag). Server commands and ports live in the script; logs in
`$TMPDIR/mcp-gateway/<server>.log`. Check with `mcp-gateway status`. After editing
it, `launchctl kickstart -k gui/$UID/com.nathan.mcp-gateway`; open Pi sessions
reconnect on their own.

## Slack MCPs (Superbuilders and Alpha)

- `slack` is Slack's official MCP (`https://mcp.slack.com/mcp`, OAuth) in the **Superbuilders**
  workspace (`superbuilding.slack.com`), as `nathaniel.koerschner@superbuilders.school`.
- `slack_alpha` reaches the **Alpha** workspace (`go-alpha.slack.com`, team `T8E6M88BS`), which hosts
  the Texas Sports Academy channel `#arcade2026825`. Slack's official MCP app isn't installed there, so
  it runs [`slack-mcp-server`](https://github.com/korotovsky/slack-mcp-server) `@1.3.0` in the shared
  MCP gateway (port 7385) on the Slack desktop app's own session on ag (Nathan's user `U0BEES3UT3P`).
  Tools include `conversations_history` / `_replies` / `_search_messages` and
  `conversations_add_message` (posting as Nathan).
- Setup on ag: sign the Slack desktop app into Alpha (Nathan: email + password or Rippling), then run
  `slack-session-auth store`. It reads the app's `xoxc` token and decrypts its `d` cookie (Keychain item
  `Slack Safe Storage`; first time, macOS asks for ag's login password, which agents fill from
  `ag Mac login`; `security` was given Always Allow), keeps the token whose `auth.test` is Alpha, and
  stores Keychain items `ag Slack T8E6M88BS xoxc` / `xoxd`. Then
  `launchctl kickstart -k gui/$UID/com.nathan.mcp-gateway`. `slack-session-auth check` tests them.
  If the desktop app signs out of Alpha, the session dies: sign in again and rerun `store`.
- Only ag has the session; on other machines `slack_alpha` idles (no Keychain items).

## Texas Sports Academy MCP (arcade.school)

Pi (via the shared MCP gateway above) and Codex register `arcade_school` using
`mcp-remote@0.8.3`, bridging stdio locally to Streamable HTTP at
`https://api.texassportsacademy.com/mcp`. Bun must be installed at `~/.bun/bin/bunx`.

The credential is **not tracked**. Provision it through an approved secure channel
into `~/.config/mcp/arcade-school.headers` (directory mode `0700`, file mode
`0600`) with a single line:

```text
Authorization: Bearer <private token>
```

The configs pass only the header-file path, never the token, as process arguments.
Do not enable `mcp-remote --debug` or share the credential file or session exports
containing credentials. The key has no automatic expiration; rotate/revoke it
through the issuer if exposed. Missing credentials cause the bridge to fail closed.
Restart Pi/Codex after provisioning or rotating the file. In Pi, check
`/mcp arcade_school` and call `mcp_arcade_school_whoami` to verify identity.

Access uses the production read-only database role and the full MCP toolset.
Start with `whoami`, then `list_tables` and `describe_table` before querying.
Raw device events are in `public.device_events`; `device_analytics` rollups
are not accessible with this role. Private S3 screenshots/archives require
separate access. Academic XP is in the `student_portal.strata_*` tables;
`public.xp_events` is the separate family rewards system.

Follow-up analysis: count distinct students each day who join the arcade but do
not attend the daily call. Identify the arcade-join and call-attendance sources,
student identity join, day/time zone, and reporting date range before calculating;
a missing attendance record alone should not be treated as proof of absence until
attendance coverage is verified.

## Machine-local AI gateway

AI tools use their standard OAuth/API authentication by default. To opt one
machine into TrueFoundry, add only the gateway token to `~/.zshenv.local`:

```sh
export TFY_TOKEN="..."
```

On opted-in machines, the shell routes Claude Code, Pi, and Codex through
TrueFoundry. Keep `~/.zshenv.local` untracked; machines without `TFY_TOKEN`
continue using the standard providers configured by each tool.

## Screen recordings (QA video)

Agents hand Nathan QA walkthroughs as video, not just screenshots. Both helpers write H.264/yuv420p
mp4s with faststart, so they play in QuickTime and inline on iPhone Safari.

- **Headless**: `record-flow <url> [flow.ts] [-o out.mp4] [--mobile] [--storage state.json] [--trace]`
  records a Playwright flow (Storybook story URL, staging, a local dev server). `flow.ts`
  default-exports `async ({ page, context, pause }) => { … }`; use `pause(ms)` between steps so a
  viewer can follow. `--storage` takes a Playwright storageState, e.g. a signed-in staging session.
  Playwright is installed on first run into `~/.cache/record-flow` (pinned; Chromium auto-installs),
  independent of any repo. If the flow throws, the video up to the failure is still saved.
- **Desktop**: `screen-record start [-w "Google Chrome"]` … `screen-record stop` (prints the mp4)
  records ag's main screen, or crops to one app's front window, while `chatgpt-cua` drives it.
  ffmpeg avfoundation, 15 fps, capped at 30 min. Needs macOS **Screen Recording** for the agents'
  TCC identity, `sshd-keygen-wrapper` (see "macOS permissions for agents"); `start` fails fast
  when it's missing. Plain `screencapture -x out.png` works for single frames the same way.
- **Polished (Screen Studio style)**: `agrec start [-s N] [--fps 30]` … `agrec stop` records a
  screen *without* the cursor (`-capture_cursor 0`, wall-clock timestamps so `ffmpeg.log`'s
  `start:` is the first frame's epoch) while `cursorlog` (`share/agrec/cursorlog.swift`, a
  listen-only CGEvent tap for clicks plus 60 Hz position polling; needs Input Monitoring) writes
  `cursor.csv` into the session dir (`/tmp/agrec/<time>/`). `agrec export [dir] out.mp4`
  (`share/agrec/export.py`, a uv script with numpy + OpenCV) then: scores per-frame pixel change
  on a small gray copy; fast-forwards stretches with no change, cursor motion, or clicks for
  ≥1.2 s at 8x with a ⏩ badge (capped at 1.5 s of output each; `--drop` cuts them), keeping
  0.4 s before / 0.6 s after every change; turns instant cursor jumps into eased glides ending at
  the jump and smooths the rest (zero-lag 30 ms gaussian); draws a 1.5x macOS-style cursor with a
  press squish and click ripples; and spring-zooms (1.6x) toward click areas, holding through
  short gaps. `--plain` gives an unpolished reference. A 72 s Finder test exported to 25 s
  (20 s with `--drop`) in ~30 s.
- **Showing it**: `show clip.mp4` opens it on the client and publishes a phone player page
  (`phone:` link). In review pages, keep the page self-contained for images (base64) but put videos
  beside it as files, `<video src="flow.mp4" controls playsinline muted>`: `show page.html` copies
  referenced `src`/`poster` files along. `file-inbox` serves byte ranges, which iPhone Safari needs.

## macOS permissions for agents (TCC)

macOS attributes a process's privacy access (TCC) to its *responsible* process. On ag-mac
the Herdr server is started over SSH (`ag` from the client), and `mac run` from ag-engine is
SSH too, so **every agent command on ag-mac runs as `/usr/libexec/sshd-keygen-wrapper`**:
not Ghostty, herdr, pi, ffmpeg, or osascript. Grant things to that one Apple-signed binary;
its identity survives macOS and Homebrew updates (a grant to a Homebrew Cellar path or the
ad-hoc-signed herdr binary breaks on every upgrade). Launchd jobs (`launchctl submit`,
LaunchAgents) are their own responsible process and inherit none of it.

- `ag-access` shows what agents may do (Screen Recording, Accessibility, event posting,
  Input Monitoring, Full Disk Access, Automation targets, screen re-consent dates) and any
  permission prompt on screen. Exit 1 if a core grant is missing.
- `ag-access allow` clicks Allow on pending prompts raised for an agent identity. Codex computer
  use refuses UserNotificationCenter (where TCC prompts live) and the prompt swallows synthetic
  mouse clicks, but an Accessibility click on its button works. While a prompt is up, mouse
  input to other apps is blocked, so answer it first.
- `ag-screen-approvals` stops the monthly "X is requesting to bypass the system private window
  picker" re-consent (macOS 15+) by pushing every client's next alert in replayd's
  `ScreenCaptureApprovals.plist` to 2100, and seeds sshd-keygen-wrapper and Codex Computer Use.
  It isn't TCC.db. `install` runs it; re-run it after granting a new capture app. A first capture by
  a new identity still alerts once (it may name the process, e.g. "herdr", while the approval is
  stored under sshd-keygen-wrapper): `ag-access allow`, then `ag-screen-approvals`.
- An idle display keeps recording but serves duplicate frames: wake it with `caffeinate -u -t <s>`
  before recording (headless-display keeps a virtual display, not an awake one).
- Grants on ag-mac (2026-09-29), all to `sshd-keygen-wrapper`: Full Disk Access, Accessibility,
  Screen & System Audio Recording (System Settings → Privacy & Security → the list → + →
  Cmd+Shift+G `/usr/libexec/sshd-keygen-wrapper`), plus Automation for System Events, Finder,
  Messages, Chrome (Contacts stays denied: its toggle ignores clicks; fixing it needs
  `tccutil reset AppleEvents com.apple.sshd-keygen-wrapper` and re-allowing each target). There's no MDM (checked `profiles status`), so a PPPC profile
  can't pre-grant these; MDM couldn't pre-allow Screen Recording or Input Monitoring anyway.
  New Automation targets prompt on first use: `ag-access allow`.
- If the Herdr server is ever started from a local Ghostty on ag-mac instead of over SSH, agents
  inherit Ghostty's grants (Screen Recording and Accessibility, no Full Disk Access). Restart it
  over SSH to get the full set.
- Keychain "Allow" prompts are per item: create items agents read with
  `security add-generic-password -T /usr/bin/security …` so the CLI is on the item's ACL.

## Client ↔ ag bridge

Nathan sits at a client machine; agents run on a host (ag). Every machine stows this repo; roles and aliases are in `machines/README.md`.

- **SSH**: `ssh/dot-ssh/config` defines an alias per machine (Tailscale IPs). Each machine needs an
  `~/.ssh/id_ed25519` authorized on the machines it talks to (manual, per device), and Remote Login on.
  Machine-only hosts go in untracked `~/.ssh/config.local`.
- **Screenshots → ag**: CleanShot X on the client saves to `~/Screenshots` (Settings → General →
  Export location; after-capture actions include *Save*). Set by hand/CUA; CleanShot stores it as
  `exportPath` in `pl.maketheweb.cleanshotx` and needs a restart to apply. `shot [n]` on ag pulls
  the newest n into `~/inbox/shots`.
- **Perplexity voice off**: on the client, Perplexity Settings → Keyboard Shortcuts → *Start voice* is
  **Disabled** (default was *Hold Fn*, which fired on Ctrl/Fn), and General → Voice → Activation is
  Disabled. Stored as `voiceTriggerMode = disabled` in `ai.perplexity.macv3`. Set by hand/CUA.
- **Paste images into agents**: Hammerspoon (client only). Every CleanShot capture is uploaded to
  `ag:~/inbox/clipboard/` the moment CleanShot writes it (it watches CleanShot's media folder and
  `~/Screenshots`), so Cmd+V in a Herdr Ghostty window just types the already-uploaded ag path
  (instant); pi attaches image paths. Other clipboard images/files upload on paste (path typed first).
  Uploads reuse one SSH connection (`ControlMaster` in `ssh/dot-ssh/config`). Text pastes untouched.
  Speed limit: on the office network the machines sit behind the same symmetric NAT, so Tailscale
  relays via DERP (~1.3 MB/s; a ~1 MB screenshot lands in ~0.8s). Check with
  `tailscale ping nathan-dev-client` (want "via <ip>", not "via DERP").
- **ag → client viewing**: `show <file|dir|url>` copies to client `~/ag-inbox` and opens it there
  (HTML files bring their referenced local assets; a folder opens its `index.html`).
  Agents call it themselves (see AGENTS.md). Servers on ag are reachable at `http://ag:<port>`.
- **Reviewing on the phone**: on ag, `show` also publishes HTML pages, folders, and Markdown
  (rendered with pandoc) to `~/review/<name>/` and prints `phone: http://100.107.192.32:7374/r/<name>/`.
  `file-inbox` serves them to the tailnet, adding a phone viewport and a **Comment** button to HTML.
  A comment posts to `/r/<name>/comment` and is sent as a prompt to the pi session that ran `show`
  (matched by `$PI_SESSION_FILE` in `~/review/<name>/.meta.json`, so it survives pane moves), with
  the section heading he was reading. If that session is gone, it opens a new Inbox session.
  Nothing is exposed beyond Tailscale. Old pages in `~/review` can be deleted anytime.
- **Computer use on ag-mac is queued** (`cua-queue`): only one run drives ag-mac's desktop at a time.
  Every `chatgpt-cua` run on ag-mac (the `chatgpt_cua` Pi tool, `mac cua` from the engine, local
  calls) is a job in `~/.local/state/cua-queue/jobs/<id>/` (task, caller, status, log, report, rc).
  A detached runner per job waits for its turn (FIFO, one `zsystem flock` lock), then runs
  `chatgpt-cua` with `CUA_QUEUE_INNER=1`; the caller only watches and streams "queued behind
  <caller>, N ahead" / "running (Xs)" to stderr. `cua-queue list` (`mac cua --status`,
  `chatgpt-cua --status`; works from the engine too) shows the running job, the queue, and recent
  results. `cua-queue cancel <id>` drops a queued job or stops a running one (its cleanup still runs);
  `cua-queue attach <id>` waits for a job and prints its report. A caller that is stopped
  (SIGTERM/INT/HUP: the Pi tool aborting, Ctrl-C on `mac cua`) cancels its own job; one that vanishes
  silently (SSH dropped) abandons its job if it hadn't started, while a started job finishes and stays
  attachable. Jobs whose runner died are marked `lost` so they never block the queue. Pi's tool labels
  jobs with the session name and its AG Dash link (`CUA_CALLER`) and picks the id (`CUA_JOB_ID`).
  **Urgent jobs** (`chatgpt_cua` `urgent: true`, `CUA_URGENT=1`, `cua-queue run --urgent`) go ahead of
  every non-urgent job and preempt a running one: the queue stops its codex, the inner `chatgpt-cua`
  exits 75 without cleaning up, and the job becomes `paused` with its codex session id saved (from the
  log's `session id:` line). After the urgent job, the paused job resumes first with
  `codex exec resume <session>` (told the screen may have changed), against its original cleanup
  snapshot (kept in the job dir). Urgent jobs never preempt each other. AG Dash shows the queue in its
  header (a `CUA` pill; click for running/paused/queued jobs and recent results, with links to the
  calling sessions) next to an `engine mem` pill (ag-engine's `/proc/meminfo` used % and memory PSI;
  amber at ≥85% or ≥10% stall, red at ≥95% or any sustained full stall). The board reads
  `ssh ag-mac cua-queue json` every 5 s.
- **Client desktop automation**: `client-cua --why "<reason>" "<task>"` runs Codex computer use on the
  client's GUI session (via `launchctl submit`; plain ssh can't see the screen). It's an antipattern,
  so it's gated: `client-cua-gate` asks Jev (TrueFoundry, `TFY_TOKEN`) whether the thing exists only
  on the client (a dialog/permission prompt showing there, iPhone Mirroring, a client-only setting).
  Otherwise, or if Jev is unreachable, it blocks (exit 3) and POSTs an access session to the ag inbox
  (`/prompt?new=1`, never a follow-on) to get the missing access onto ag; deduped per task (6h) and
  per blocked session (1h). Pi's `client-cua-guard.ts` extension runs the gate before bash calls that
  invoke `client-cua`, set `CLIENT_CUA_HOST`, or SSH to the client with osascript/Hammerspoon
  UI/cliclick, and passes a one-time `CLIENT_CUA_GATE_TOKEN` so it isn't judged twice.
  Log: `~/.local/state/client-cua-gate/log.jsonl`.
- **Phone → ag**: `file-inbox` (LaunchAgent `com.nathan.file-inbox`, port 7374, Tailscale only)
  saves uploads to `~/inbox/phone` and can prompt a recent pi session or open a new one. The iOS
  Shortcut is documented in `ios-shortcuts/send-to-ag.md`. Log: `/tmp/file-inbox.log`.
- **Links to sessions**: `herdr-link <tab_id>` / `herdr-link --grep <regex>` / `herdr-link --session [file|id]`
  prints `http://ag:7376/<pi session id>`, a deep link into AG Dash (see "AG Dash"): the live card's
  drawer, or a hibernated/closed session's transcript with Wake / Resume. Session ids are stable; tab ids
  change when tabs move. `--url` prints only the URL; `--gemini` prints the old direct-jump link
  `gemini://<host>/focus/<tab>` (HerdrLink.app → Hammerspoon → `herdr tab focus`; no browser), also the
  fallback for tabs without a pi session. `http://ag:7374/focus?tab=<id>` (file-inbox) still works too.
  Plain http because Herdr strips OSC 8 and Ghostty only auto-links standard schemes.
