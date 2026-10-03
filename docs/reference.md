# Ag reference

Component-by-component detail: how each piece works, where its code, state and logs live, and how to fix it.
Start with the [README](../README.md) (what Ag is, setting it up with `ag setup`, the `ag` CLI); come here when
you need the internals of one part.

Some sections still describe ag-mac as the session host (LaunchAgents, `launchctl kickstart`). Since
2026-09-29 sessions and services run on ag-engine (tmux via `ag-mux`, systemd user units), so prefer
`ag status`, `ag logs <service>` and `ag restart <service>`, which find the machine that runs a service.

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
| `Discord bot (Arcade)` (**ag-vault**, via `op-work`) | Bot token for the `ag discord` CLI (read/post on the Arcade server as the ag bot) and `ag discord dce` exports |
| PostHog personal API key (item name in the user's personal instructions) | PostHog REST API for the Arcade's PostHog project: feature flags (`arcade_*`) read/write, e.g. `GET https://us.posthog.com/api/projects/<project id>/feature_flags/?search=arcade_` |

1Password service-account tokens (login Keychain on ag, account = ag's login user;
read only by the wrappers, never printed or put in files/args):

| Keychain service | Wrapper | Service account → vault (read_items + write_items only) |
|---|---|---|
| `ag 1Password service account` | `op-ag` | `ag arcade.school agents canonical` → `arcade.school` |
| `ag machine-shared service account` | `op-shared` | `ag machine-shared agents` → the user's personal `machine-shared` |
| `ag-shared 1Password service account` | `op-work` | `ag-shared agents` → work `ag-vault` (formerly `ag-shared`; Keychain item keeps its old name): non-super-secret work items (the work card, infra API tokens) |

Vault IDs and where each token's recovery copy lives are in the user's personal instructions.

Second-workspace Slack session (login Keychain on ag, account = ag's login user, written by `ag-slack-session-auth store`;
no recovery copy, recreate by signing Slack in again): `ag Slack <team> xoxc`, `ag Slack <team> xoxd` (`<team>` = its team id, `$AG_SLACK_ALPHA_TEAM`).
See *Slack MCPs*.

ag's own macOS login password lives in ag's login Keychain (service `ag Mac login`, account =
ag's login user), so agents answer ag's admin/password prompts (e.g. adding an app under Privacy &
Security) on ag without touching the client. The user stores or refreshes it once with
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
`add-generic-password -U -a "$USER" -s "<service>" -w ...` line on stdin),
never as a command-line argument. The user's personal 1Password account holds
everything else (banking, investments, identity, recovery codes); agents must
not use it, and it is not signed in on ag (app or Chrome extension); sign it in
only on client machines.

After `~/.zshenv.local` exists, run `ag-tfy-env` (or log out and back in) and
restart ChatGPT desktop: the stowed Codex config routes it through TrueFoundry.

## Remote attach

**Every machine (host and clients): Tailscale must launch at login.** In
Tailscale → Settings, turn on **Launch Tailscale at login** (check with
`defaults read io.tailscale.ipn.macsys TailscaleStartOnLogin` → `1`). If it's
off, a reboot or relogin leaves the machine off the tailnet and `ag`/`ssh` time
out in both directions. Enabled on the client 2026-09-28.

Clients attach to the session host with `ag` (`ssh -t <host> ag-mux attach`, its own view of every tab); the iPhone
attaches with Moshi (mosh/ssh, tmux picker). Every key binding lives in the host's tmux config, so
nothing is configured per client beyond Hammerspoon's Cmd → prefix forwarding.

## Agent skills

User skills live in `agents/dot-agents/skills/<skill>/SKILL.md`. Stowing the `agents` package symlinks them into `~/.agents/skills/<skill>/SKILL.md`, which is what pi (and other tools) load via `settings.json` (`"skills": ["~/.agents/skills"]`).

`settings.json` also points at `~/arcade.school/.agents/skills` so the arcade repo's skills (`/skill:arcade-*`) are available from any cwd. This is the main checkout only, not worktrees; those skills assume you `cd` into a checkout before running repo commands.

Codex system skills live alongside under `agents/dot-agents/.system/` and stow to `~/.agents/.system/`.

## Global agent instructions

Pi, Claude Code, and Codex all load one file, `pi/dot-pi/agent/AGENTS.md` (the `claude` and `codex` packages symlink to it). That file is generated and untracked: edit the sources and run `agents.md/build`. Each top-level section is its own file in `agents.md/sections/`, concatenated in filename order (`010-…`, `020-…`; renumber to reorder); a line `<!-- include: NAME.md -->` pulls in a longer doc from `agents.md/includes/` with its headings nested. Your own layer, `~/.ag/agents.md/` (`$AG_USER_AGENTS`; typically stowed from your dotfiles), has the same layout: its sections merge into the same order (a same-named file replaces ag's) and its includes win. ag ships only generic sections; personal rules (for example how agents attribute what they write) live in that layer. `install`, `bootstrap-linux` and `ag sync` rebuild it.

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

`ag-private` is a private chat page for personal questions: `http://ag:7375/`, Tailscale only. Unlike everything else on ag, its inference goes straight to OpenRouter on the user's **personal** account, never TrueFoundry, Jev, or the ag-inbox.

- Key: `OPENROUTER_API_KEY` in `~/.zshenv.local` (personal OpenRouter account, paid with the user's personal card). pi's `openrouter` provider in `models.json` reads the same variable. Without it the page answers "OPENROUTER_API_KEY isn't set on ag yet."
- Every request sends `provider: {data_collection: "deny", zdr: true}` (no provider training or retention). In the OpenRouter account settings, keep prompt logging off.
- Chats are stored only on ag in `~/private-chat/<id>.json` (dir 0700, files 0600); nothing about their content is logged. Model picker: Claude Opus 5.5 (default), GPT-6 Sol, Gemini 3.8 Flash (`MODELS` in the script; only models with a zero-data-retention endpoint work, e.g. Claude Fable has none).
- Phone: Back Tap triple tap → shortcut **Private ag** (`ios-shortcuts/private-ag.md`).
- Code: `bin/dot-local/bin/ag-private`; LaunchAgent `com.ag.ag-private` (only runs on ag). Server output: `/tmp/ag-private.log`. Restart: `launchctl kickstart -k gui/$(id -u)/com.ag.ag-private`.

## ag-dash

**ag-dash** is the app over every agent session (ag-mux on tmux), ChatGPT-desktop style: **https://ag.<tailnet>.ts.net:7377/chat** (Tailscale only; `http://ag:7376/` redirects there, since browsers only allow the microphone on https). ag-mux stays the runtime; ag-dash is a view on it plus a little metadata ag-mux doesn't keep. (The old Kanban board was retired on 2026-10-03; its URLs, including `ag link`'s `http://ag:7376/<session id>`, redirect into the app.)

- **iPhone app:** with Tailscale connected on the phone, open the https URL in Safari → Share → **Add to Home Screen** (keep "Open as Web App" on). It launches full-screen as "ag-dash" with the AG logo icon (a slanted green seven-segment "AG", also in the board header): `manifest.json` (standalone, PNG 192/512 icons) plus Apple meta tags (`apple-touch-icon` 180 px PNG, since iOS ignores SVG icons; `black-translucent` status bar), `viewport-fit=cover` with `env(safe-area-inset-*)` padding, a non-sticky header on narrow screens, and the SSE stream reconnects whenever the app comes back to the foreground. Icons are the logo on a dark tile: `icon.svg` is the source (rounded corners, used as the favicon); the PNGs are the same art rendered full-bleed with Playwright (iOS rounds the corners).
- **The app (`/chat`):** **Sidebar:** New chat (⇧⌘O), Search chats (⌘K: a dialog over open chats with matched snippets, plus "Search everything", which runs `ag search` over every session, closed ones too), Inbox / Needs you / Working / Waiting for (list pages with counts; **Inbox** = sessions the user hasn't replied to yet, the card's `inbox` flag: no prompt after the first one except ones Ag injected), Pinned and Chats. **Drag and drop:** drop a chat on Pinned to pin it, on Chats to unpin it; Pinned lists newest pin first (`pinnedAt`, set by `/api/card`); renaming (a chat's ⋯ › Rename) edits the name in place, like ChatGPT; **Archived chats** (profile menu, `/chat?view=archived`) lists sessions closed in the last two weeks (`ag find --closed`, `GET /api/archived`) with a filter and Restore; **notifications:** a pinned chat whose agent stops working (done, idle or blocked) posts a system notification unless you're looking at it (click opens the chat; toggle "Notify when pinned chats are ready" in the profile menu; the permission prompt is asked on your first click or keypress, since Chrome needs a user gesture); hovering a chat shows an **archive** button (one click, no confirmation, like ChatGPT; a 6 s Undo toast, and the tmux tab closes only after it, or when the page goes away; archiving a chat whose agent is **working** keeps it running, hidden, listed as Running at the top of Archived chats: when it stops, Jev reads the outcome and a finish Jev judges done (nothing left for the user) closes the tab, while a failure, blocker or question brings it back pinned and unread with a fast-lane notification; the board's archive does the same) and a ⋯ menu (rename, pin, waiting, unread, archive), and a profile menu (Routines `/chat?view=routines`: every recurring job with schedule, last run, result, Run now and Log; ag-rules `/chat?view=rules`; Archived chats; keyboard shortcuts ⌘/ (from the keys ag-rule `ag-dash-keys`); **Theme**: System / Light / Dark, kept in localStorage and applied before first paint). ⇧⌘S collapses it to an icon rail. **Header:** a model picker (📌 on a row pins that model to the top, in pin order, kept server-side via `POST /api/model-pins` and returned by `/api/config`; the rest fold under More models; with nothing pinned it lists them all) that switches the chat's model (pi's enabledModels) and thinking level (`POST /api/model` types pi's own `/model <provider/id>` and `/thinking <level>` into the session, this chat only), and shows its folder, context, cost; Share (copies the link); ⋯. **Thread:** the transcript as a chat, with thinking, tool calls and interim notes folded into "Thought/Worked for …" disclosures (each step expands to arguments and result), copy and read-aloud on answers, copy and edit on prompts, a live shimmer line while the agent works, and a dialog card with the terminal and keys when it's blocked. **Composer:** Enter sends (Shift+Enter new line); while the agent works a reply steers, ■ stops it (Esc only leaves the box), ⌥⌘Enter interrupts and sends; + attaches (paste and drop work too); the mic (⌥V) transcribes into the box (`POST /api/transcribe`); the round button, when the box is empty, records a voice message and sends it. New chats go to the ag-inbox (`/api/new`, route=new). `/chat/<session id>` deep-links a chat (ag-dash session links in answers, e.g. `http://ag:7376/<session id>`, open in-app there; other links open a new tab); closed or hibernated ones show read-only with Resume / Wake. **On a Mac, use the ag-dash app** (`macos-apps/ag-dash`, client Macs, built by `install`), the same page in a thin Electron shell (there is no Chrome-installed PWA any more: `chat.html` has no web manifest, so Chrome doesn't offer to install it; its window-controls-overlay CSS is for ag-dash's overlay title bar, so the header doubles as the title bar). Electron rather than a PWA because a PWA can't own a system-wide shortcut: Ctrl+Cmd+A shows and focuses it, or hides it when it's in front; it opens at login, closing the window hides it, the page's notifications (pinned chats becoming ready) are shown natively by the main process (`preload.js`; Electron's web notifications fail on macOS) and clicking one brings the window back and opens the chat, links outside `/chat` open in the browser, while session links (`ag link`'s `http://ag:7376/<session id>` or `/t/<tab>`) always open in the app: clicked in a Mac browser (an HTML review page, Ghostty, Slack), ag-dash answers with a hand-off page (on its https origin, so Chrome's "Open ag-dash?" prompt offers Always allow and asks once) that opens `agdash://chat/<session id>?h=<nonce>`; the app acknowledges the nonce (`POST /api/handoff`) and the page then goes back to where the link was (or closes its tab) (`?web`, the iPad and the phone get the web chat), and when ag-dash can't be reached (or its proxy answers 5xx) it shows an offline page (`offline.js` + `offline.html`) instead of a blank window: why (Tailscale stopped on this Mac, needs a sign-in, not installed or not running; ag-engine not answering; ag-dash not running on it) with a button for the local fixes (Start Tailscale runs `tailscale up`; Open Tailscale; Download Tailscale) and Retry now, probing every 3 s and reloading the chat the moment ag-dash answers. It loads the live page, so `chat.html` edits only need Cmd+R; `install.sh` rebuilds the app only when its sources (`*.js`, `*.html`, `package.json`) or the icon change; it also handles `agdash://entry`, the quick entry box (see "The ag-inbox") (a rebuild is a new ad-hoc identity, so macOS asks for the microphone again). **Testing it:** agents test ag-dash (quick entry, focus, windows) on ag-mac, never by driving the client: `ag-mac run 'cd ~/ag && git pull -q && AG_DASH_TESTBED=1 zsh macos-apps/ag-dash/install.sh'` builds it there without launching it; then e.g. `ag-mac run 'open -g -a "$HOME/Applications/ag-dash.app" "agdash://entry?"'` (or `open -g "agdash://chat/<session id>"` for session-link hand-off; a real click on an ag link in ag-mac's Chrome goes through `ag cua`) and check the frontmost app/windows with `osascript` (`get name of every window of process "ag-dash"` shows the opened chat's title); afterwards `osascript -e 'quit app "ag-dash"'` and delete its login item (`osascript -e 'tell application "System Events" to delete login item "ag-dash"'`). **On a phone** it follows ChatGPT's iPhone app: the sidebar slides in and pushes the chat over (tap ☰ or swipe right anywhere; swipe left or tap the dimmed chat to close; it follows the finger), with a Search field and compose button on top; the header is a translucent bar the chat scrolls under, showing just the model; every menu is a bottom sheet (swipe down or tap outside to close); long-press a chat (sidebar or a list) for its menu, or a message for Copy / Select text / Read aloud / Edit; a new chat has the greeting in the middle and the composer at the bottom, and the app is sized to the visual viewport so the composer rides the keyboard. Added to the iPhone home screen (Safari → Share → Add to Home Screen) it runs full-screen as "ag-dash" from its Apple meta tags (`apple-mobile-web-app-capable`, title, `apple-touch-icon`), no manifest needed. Test suite: `node ~/.agents/skills/mobile-review/scripts/agdash-chat.mjs` (simulated iPhone, writes stubbed). Page: `ag-dash/dot-local/share/ag-dash/chat.html` (needs only a refresh after edits).
- **Pinned (top priority):** ⇧⌘P, ⌘Enter when sending, a chat's ⋯ menu, or `ag pin`. Pinned chats sit in Pinned at the top of the sidebar. When a pinned agent stops working and becomes ready with something new, the fast lane fires: `ag-text` (with a link straight to the card) plus a tmux toast; At most one ping per chat per minute; opening the chat marks it seen. On the client Mac, every pinned chat that is stalled also gets a **persistent desktop alert** from ag-dash (`macos-apps/ag-dash/main.js`, polling `GET /api/pinned` every 5 s; its notification style is Alerts, so it stays on screen, and it's an allowed app in Do Not Disturb, so it breaks through). It's withdrawn the moment the item is addressed (the agent works again, it's marked waiting, or it's unpinned); Open jumps to the session; if it's closed while still stalled, it comes back after 10 minutes.
- **⏳ Waiting for:** a session with a live ag-tickler item (a wake-up waiting on CI / a check / an event, a presence item, a scheduled time, or a GTD waiting-for on a person; matched by the item's session file) is listed under **Waiting for**. It isn't "needs you" and never pings; it shows what it's waiting on (the check command, person, or due time). A chat's ⋯ menu marks it waiting by hand. **Waiting always wakes up** (AGENTS.md → GTD model): a hand-set wait makes ag-dash prompt that session, once it's at its prompt, to schedule its own ag-tickler wake-up at an interval it chooses; until the item exists it is re-asked up to 3 times, 15 minutes apart. The ag-tickler item then takes over and the hand-set flag drops; giving the session new work also clears it. A blocked dialog still shows as Needs you.
- **Deep links:** `http://ag:7376/<pi session id>` (what `ag link` and `ag-session-link` print) redirects to `/chat/<pi session id>`: the live chat, or for a hibernated or closed session its transcript with **Wake** / **Resume** (a new tab running `pi --session <file>`).
- **Needs you** = blocked, or ready with an answer newer than when you last saw it. Seen = opened in ag-dash, replied from it, jumped to in tmux, or the tab focused in tmux. **Resolved** (server-side only, no column) = Jev read the latest answer and judged the session done, with nothing left for you; judged only for chats archived while working (one small call per new answer, cached).
- **Click telemetry:** one delegated listener on the page logs every button/control click (a stable name from `data-t`, else `id`/`data-*` action/aria-label/title/text; plus desktop or phone view) with `navigator.sendBeacon` to `POST /api/click`, which appends `{ts, name, view}` to `~/.local/state/ag-dash/clicks.jsonl`. `ag-dash-stats [days]` (or `GET /api/stats?days=N`) ranks controls by clicks. Nothing leaves ag.
- **State:** `~/.local/state/ag-dash/state.json` (pinned, list, waiting, seen time, status timing, lists), keyed by pi session id so flags survive a pane moving to another tab (tabs without a session fall back to the tab id). Entries for sessions no longer open are dropped.
- **How it works:** polls `ag-mux api snapshot` every 1.5 s, reads each Pi session file incrementally (only appended bytes), and pushes the state to open pages over SSE. Listens on ag's Tailscale IP and on 127.0.0.1; at startup it runs `tailscale serve --bg --https=7377 http://127.0.0.1:7376` (idempotent; tailscale serve can't reach ag's own Tailscale IP, hence the loopback listener). Media is served only for image/video files under `~` or `/tmp` (`/api/file`, with Range support) and for images inside session files (`/api/embedded`).
- Code: `bin/dot-local/bin/ag-dash` (systemd user unit `ag-dash.service` on the session host; `ag restart ag-dash`, `ag logs ag-dash`); page: `ag-dash/dot-local/share/ag-dash/chat.html` (+ `keys.js`, `telemetry.js`, `manifest.json`, icons; page edits need only a refresh).


## Routines

A **routine** is an ag job that repeats on its own, without anyone asking (as opposed to an ag-tickler item, which
wakes one session once). Modeled on [Claude Code routines](https://code.claude.com/docs/en/routines): a saved,
self-contained prompt (or an `ag` command) plus triggers, where each run is a fresh, unattended session.

- **Define** one per file in `routines/<name>.md`: front matter `description`, `schedule` (`hourly`,
  `daily HH:MM`, `weekdays HH:MM`, `weekly Mon[,Thu] HH:MM`, `every 30min`, or `calendar <OnCalendar>`; Central
  time), `kind` (`prompt`, default, or `command` with `command:`), `cwd`, `model`, `timeout`, `enabled`; the body
  is the prompt. `ag routine new <name> --schedule … < prompt.md` scaffolds one. Commit it.
- **Schedule:** `ag routine apply` writes `<name>.timer`/`.service` into `~/.config/systemd/user` on the session
  host (marked generated; removed when the definition goes); `bootstrap-linux` runs it.
- **Triggers:** the schedule; Run now (`ag routine run <name>`, or ag-dash → Routines); fire with run-specific
  text (`ag routine fire <name> --text …`), delivered in a `<routine-fire-payload>` block marked untrusted, so a
  prompt must opt in to acting on it (Claude's API-trigger rule). One-off "later" jobs go to the ag-tickler.
- **Runs:** prompt routines run `pi -p` as a new session named `Routine: <name> <date>` (open it from the AG
  Dash card) with a preamble (unattended, AGENTS.md applies, spin out an Inbox session if the user is needed, end
  with `RESULT: ok|fail — summary`). Each run writes `~/.local/state/routines/<name>.json`
  (`{at, ok, summary, session?}`) and appends `<name>/runs.jsonl`; one run at a time per routine.
- **Inspect:** `ag routine list | show <name> | log <name>`.

Older routines are hand-written systemd timers in `systemd-user/` or ag-mac LaunchAgents with
`StartInterval`/`StartCalendarInterval` in `macos-launchagents/` (one-line `<!-- … -->` description in the
plist); they write the same state file. ag-dash → **Routines** lists all of them.

| routine | where | what |
|---|---|---|
| `ag-tickler` | engine, every 60 s | fires due ag-tickler items |
| `ag-presence` | engine, every 30 s | is the user at their Mac |
| `ag-pi-sessions-sync` | engine, hourly | archives Pi sessions to GitHub |
| `ag-state-sync` | engine, every 15 min | snapshots Ag state (layout, ag-tickler, ag-dash, inbox…) to GitHub |
| `ag-toolsum-review` | engine, daily 9am Central | extends ag-dash's tool-call summary rules (`ag-toolsum/README.md`) |
| `ag-cli-usage` | engine, Mondays 9:07 Central (`routines/`) | audits `ag` CLI adoption vs hand-rolled equivalents (`ag usage`), writes `docs/ag-cli-usage.md`, spins out one fix |
| `ag-mem-watch`, `nessie`, `ag-chrome-tab-reaper` | ag-mac | memory alerts, Nessie trace sync, closing stale Chrome tabs |

## ag-rules

**ag-rules** are the UX layer on top of Ag: shortcuts and standing behaviors, each a rule in plain English that
boils down to code. ag is the engine (hooks, the `ag-rules` CLI, `ag-rules/engine.ts`, the runtimes, the actions
each app exposes). Rules are folders (`rule.md` + its code): the user's in **`~/.ag/ag-rules`** (from their
dotfiles, stow package `ag`), on top of ag's defaults in `ag-rules/` (the Jev judgments: see "Jev"
below). Hooks: `prompt` (Pi), `keys` (ag-dash, the ag-dash Mac app incl. quick entry, Ag's session shortcuts),
`hammerspoon` (Mac), `capture` (ag-inbox), `new-item` and `answer` (ag-dash), `cua` (ag-client-cua-gate),
`tab-name` (ag-tab-name). Format, runtimes, what each does without a rule, and what isn't an ag-rule:
[`ag-rules/README.md`](../ag-rules/README.md). `ag-rules list | show <name> | keys <app> | path | eject <name>`;
ag-dash → profile menu → ag-rules.

## Nessie (agent-trace sync)

Directive: every agent trace paid for by the company must sync to Nessie; only the user's personal OpenRouter usage must not. Nessie (`cask "nessie-app"`, nessielabs.com) runs on every machine, signed in with the user's work email.

- **On ag-engine (session host, Linux):** headless, no app. `@nessielabs/daemon` (npm, `--prefix ~/.local`; installed by `bootstrap-linux`) provides `nessie-daemon`; systemd user unit `ag-nessie.service` runs its `nera` runtime (host role only). Integrations Pi, Codex, Claude Code (`nessie-daemon integrations list`); automatic ingestion + cloud sync are on (`nessie-daemon run` turns them on; the setting persists). Signed in by device pairing: `nessie-daemon auth login --pair --no-open`, then in Nessie on ag-mac **Settings → Devices → Authorize** and enter the code (CUA can do it); login lives in `~/.local/share/nessie/` (0600, never print). Then `nessie-daemon integrations add pi` (and `codex`, `claude_code`). Check: `nessie-daemon status`. Docs: nessielabs.com/docs/nessie-daemon, /docs/linux-endpoint-client (the Linux desktop `.deb` needs a display; not used).
- **Integrations on ag:** Pi (`~/.pi`), Claude Code (`~/.claude`), Codex (`~/.codex`); local only, set in the app's onboarding. Web accounts (Claude.ai, ChatGPT, Perplexity) are connected on the client (ag-client), which also has Pi and Cursor; don't connect them twice. Check: `/Applications/Nessie.app/Contents/MacOS/nessie-cli status` and `nessie-cli transcript list --type pi`.
- **Sign-in on a new machine:** open Nessie and sign in, or copy `access_token.txt`, `refresh_token.txt`, `user_info.json`, `deployment-selection.json` from `~/Library/Application Support/Nessie/` on a signed-in machine (dir 0700, files 0600; never print them). Don't copy `device.json` or `notes.sqlite`: each machine registers as its own device. Then finish onboarding in the app and connect the local integrations.
- **Kept running** by LaunchAgent `com.ag.ag-nessie` (opens it at login and every 5 min if it isn't running).
- **Stalled but running:** the LaunchAgent can't see a hung app. On 2026-09-28 the client's Nessie 1.4.4148 sat on an update dialog and hadn't synced since Sep 23; installing the update fixed it. Check `lastSyncedAt` in `notes.sqlite`'s `integration` table (read-only), since `nessie-cli` can't reach the app over SSH.
- **Stalls:** Nessie can keep running but stop picking up new sessions (seen on ag 2026-09-28: nothing new after 02:43 until a restart). If `nessie-cli status` shows `ingested`/`synced` hours old while agents are active, or a current session is missing from `nessie-cli transcript list --type pi`, quit and reopen the app (`osascript -e 'quit app "Nessie"'; open -g -a Nessie`); it catches up within a few minutes.
- **OpenRouter stays out.** Nessie can't filter by provider; it syncs everything under its base paths. So OpenRouter never writes there: `ag-private` keeps chats in `~/private-chat`; pi on OpenRouter runs only through `ag-pi-private` (sessions in `~/private-chat/pi-sessions`); the `nessie-openrouter-guard` pi extension reverts any `openrouter` model picked in a session under `~/.pi` to Opus 5.5 on TrueFoundry. The 113 older pi sessions (May–July 2026) that used OpenRouter were moved from `~/.pi/agent/sessions` to `~/private-chat/pi-sessions/` before Nessie first scanned (list: `.moved-from-pi-sessions.txt` there). If one slips in, delete it in the Nessie app ("exclude from future syncs").

## ag-inbox

The ag-inbox is the top-level endpoint that starts a new session: POST a prompt and ag opens a new tab running pi with it as the first prompt. Every capture path goes through it: the Mac quick capture, the iPhone Action Button, and ag-file-inbox's "New session".

- Test page: http://ag:7373/. Tailscale only.
- API: `curl -X POST http://ag:7373/prompt -d 'your prompt'` → `202`, no body. Form posts take `text` and an optional `id`; a repeated `id` within 24 hours is acknowledged without opening a second tab (so the phone's offline queue can resend safely).
- Screenshots: a multipart form can add `screenshot` (image file) plus `app`/`window` (frontmost app and window title). It's saved to `~/inbox/capture/` and always attached (the prompt ends with the file path for pi to read): the sender decides whether to include one (on the Mac, by holding Shift with the capture shortcut). `pin=1` pins the session the capture lands in.
- **Mac quick capture: both Command keys at once** (add Shift to include a screenshot), by default (the keys ag-rule `quick-entry`; chords, keys and the box's keys are all set there). The ag-dash Mac app does it all itself: `macos-apps/ag-dash/app/hotkeys.js` watches the modifier-only chord (uiohook-napi in the app shell, since Electron can't register one; needs Accessibility for ag-dash), `main.js` grabs the screen under the mouse first when Shift is held (1x JPEG in `~/Library/Caches/ag-inbox`; needs Screen Recording for ag-dash) and opens the box (`app/entry.js` + `entry.html`: a floating panel, prebuilt and hidden so it opens instantly, on the display under the mouse). `agdash://entry?shot=…&app=…` opens it too. Enter sends, Cmd+Enter sends and pins (and anything that session defers with the ag-tickler comes back pinned too), Shift+Enter is a newline, Esc closes. Click the thumbnail to annotate in CleanShot (its Cmd+S saves over the file and the box shows the annotated version), ✕ drops it; pasted images are attached. ag-dash uploads in the background; on failure it notifies and copies the prompt to the clipboard.
- iPhone screenshots: the Action Button capture sends `screenshot` plus `source=iphone` (no app/window context); like every screenshot, it's attached.
- Shared files and links (iPhone share sheet, `ios-shortcuts/share-to-ag.md`): `file` (repeatable) is always attached, saved to `~/inbox/share/` (HEIC and other formats pi can't read are converted to JPEG); `url`/`shared` carry a shared link or text. With files or a link, `text` may be empty, and the agent is told to work out what's most likely wanted.
- **Follow-ons go to their thread.** In parallel with routing, Jev checks whether the capture is new context for something already open ("the thing I was calling study film…", "for the consent sankey, also…"). One request, two questions over `{new_message}`: a `noul` (does it refer back to ongoing work?) and a `choice` over every open pi session (one per tab, described by its tab label plus its first and latest prompt, read from the pi session file) plus `none`. Ongoing ≥ 0.7 and match ≥ 0.8: the capture (after the screenshot gate) is prompted straight into that session under a `kind="follow"` origin tag (see "Prompt origins"; the Jev score is logged, not shown to the agent), and a tmux toast names it; no new tab. Ongoing ≥ 0.5 and match ≥ 0.3: a new Inbox session opens as usual, but its prompt names the likely session and how to forward it once the user confirms. Otherwise, or on a Jev failure, a playbook match, or a session blocked on a dialog: a normal new session. Adds ~0.6 s. Clear follow-ups score 0.97–1.0; a vague "any update on that thing?" ~0.6 (→ hint). Log step `thread` (action, `ongoing`, `p`, tab), then `followed` or `follow_failed`; tune the thresholds (`FOLLOW`/`HINT` in `ag-inbox`) from it.
- Otherwise every capture opens a new tab (in the **Inbox** until the user replies to it). A fast multimodal model (TrueFoundry Gemini Flash Lite; it sees shared images, not the screenshot) names the tab and picks a playbook. Nothing is focused, so attached clients aren't disturbed.
- **Playbooks** (`ag-inbox/dot-config/ag-inbox/playbooks/*.md` → `~/.config/ag-inbox/playbooks/`, re-read on every request): set workflows for typical kinds of captures. Each is a Markdown file with frontmatter `name` and `when` (what the router matches on); its body is prepended to the prompt when matched. Add a file to add a workflow; no restart needed. Current: `contact` (a name + phone/email, or a contact card/business card image → look them up, add to Contacts, message them as the user, drafting for their OK unless they said what to send). Contacts run on the client Mac via `ag-client-people` (`find`/`add`/`text`), since ag-mac's Contacts sync isn't reliable. **Messages work on ag-mac**: it's signed in to iMessage (the user's Apple Account) with iCloud sync, so `ag-messages` (skill `imessage`) lists recent/unread chats, reads any thread including group chats, searches, resolves contacts by name, fetches attachments, and sends text and files as the user (reporting delivery). Never read Messages through the client's desktop.
- Dry run: form field `dry=1` routes and gates only and returns `{label, playbook, thread, prompt}` as JSON, opening nothing (`thread` = the follow-on decision).
- Code: `bin/dot-local/bin/ag-inbox`; LaunchAgent: `com.ag.ag-inbox` (only runs on ag).
- Log: `~/.local/state/ag-inbox/log.jsonl`, one line per step (`received → routed → tab → pi_started → sent` (+ `pinned`), or `route_failed`/`thread_failed`/`pin_failed`/`duplicate`/`failed`). Server output: `/tmp/ag-inbox.log`.
- Restart after edits: `launchctl kickstart -k gui/$(id -u)/com.ag.ag-inbox`.
- Voice: a multipart `audio` field (or a queued audio file sent as `text`) is saved to `~/inbox/capture/` and transcribed with Whisper via TrueFoundry (`whisper-1`, falling back to `openai-esw/whisper-1`); the transcript is the prompt (log step `transcribed`, or `stt_failed`, in which case the agent gets the file path).
- iPhone Action Button capture (Voice to ag on the Action Button, Capture to ag (text only) on the Home Screen; voice attaches a screenshot): `ios-shortcuts/capture-to-ag.md`. iPhone share sheet: `ios-shortcuts/share-to-ag.md`.

## ag-telemetry (crashes everywhere)

One readout for every crash, failure and restart across Ag: **`ag telemetry`** (last 24 h of crashes and errors;
`--all` adds restarts and updates, `--since 7d`, `--source`, `--machine`, `--json`; `ag telemetry tail` follows), the
page **http://ag:7378** (Tailscale only), and a `crashes` line in `ag status`. Code: `bin/dot-local/bin/ag-telemetry`.

- **Service:** `ag-telemetry.service` on the session host stores events (30 days) in
  `~/.local/state/ag-telemetry/events.jsonl`. Every producer on any machine appends a JSON line to its own
  `~/.local/state/ag-telemetry/spool.jsonl` (survives crashes and offline machines); the host ingests its spool every
  2 s, Macs ship theirs with `ag-telemetry flush` / the collector (`POST http://ag:7378/event`).
- **Host collector:** follows the whole journal (`sudo journalctl -f`): units that die, fail or get auto-restarted
  (crash), requested restarts (info, tagged with the ag commit when one just landed, so a deploy isn't mistaken for a
  crash), kernel OOM kills, core dumps, uncaught errors in Ag services' output, unclean reboots.
- **Mac collector:** LaunchAgent `com.ag.ag-telemetry` (every Mac, every 60 s): DiagnosticReports (crashes, hangs,
  panics, jetsam, every app), Electron Crashpad minidumps, `com.ag.*` LaunchAgents exiting non-zero or killed, unclean reboots.
- **Apps:** the ag-dash Mac app (`main.js`: renderer/GPU/utility process crashes, hangs, main-process exceptions; its
  installer logs an `update` event before it quits the app for a rebuild), the ag-dash pages (`static/telemetry.js` →
  ag-dash `/api/telemetry`: uncaught errors and rejections, browser, phone or Mac app), and pi (extension
  `ag-telemetry.ts`: uncaught exceptions and non-zero exits, with the session file).
- **From any script:** `ag telemetry send [--severity crash|error|warn|info] [--kind K] [--source S] "message"`.

## Tickler (deferred tasks)

GTD ag-tickler for Ag's sessions. Say it in plain text to any pi agent ("do X Friday at 9", "send this back to me in two weeks"); the agent calls the `ag-tickler` tool. At that time a new tab `⏰ <title>` opens, running pi **forked from the conversation that deferred it**, with the task as its first prompt. Nothing is focused; a tmux notification fires.

- Tool: `pi/dot-pi/agent/extensions/ag-tickler.ts` (schedule / list / cancel). CLI: `bin/dot-local/bin/ag-tickler add|list|cancel|trigger|fire`.
- LaunchAgent `com.ag.ag-tickler` runs `ag-tickler fire` every 60s, only on ag (the host). Items missed while asleep fire on wake and say they're late.
- State: `~/.local/state/ag-tickler/<id>.json`; log `log.jsonl` beside them (`added → fired`, or `failed` with the error). launchd output: `/tmp/ag-tickler.log`.
- **Waiting for** (GTD): when an agent is waiting on another person, it schedules `waitingFor: "<name>"` + `at` (CLI `ag-tickler add --at … --waiting-for <name> [--attempt N] [--check '<sh>']`). At check-in (`⏳ <title>`, or early if `--check` passes, e.g. a DNS change) the agent checks for their reply: replied → next step; gave a timeline → requeue after it; silent → one friendly follow-up, requeue with backoff (1 → +2d → +4d → +1w), then stop and ask the user. Resumes the deferring session in place when it's open.
- **Presence trigger** ("resume this next time I'm on the client"): the agent schedules with `when: "online"` instead of a time (CLI `ag-tickler add --when online …`). It opens as `🟢 <title>` on the user's next arrival at the client after it was queued, once. Uses `ag-presence` below.
- **Wake-ups** (an agent waiting on something slow: a machine coming back, CI, a deploy): `when: "check"` with a shell `check` (CLI `ag-tickler add --when check --check '<cmd>' …`) is run by the every-minute LaunchAgent with no model (20s cap) and fires once it exits 0; `when: "event"` fires only via the webhook `POST http://ag:7373/ag-tickler/<id>` (served by `ag-inbox`; optional body = note) or `ag-tickler trigger <id>`. Both resume the deferring pi session **in place** (`ag-mux agent prompt` to the pane whose session matches, if idle/done), else open a forked `🔔 <title>` tab. After `--expires` (default 7 days) they fire anyway and say the condition never came true.

## Presence ("the user is online")

`ag-presence` on ag answers "is the user actually at the client Mac right now?" Run `ag-presence` (one line) or `ag-presence status --json`.

- **How:** LaunchAgent `com.ag.ag-presence` runs `ag-presence poll` every 30s, only on ag. One SSH call to the client (`$PRESENCE_CLIENT`, default `ag-client`; ControlMaster keeps it ~0.2s) reads HID idle time (real keyboard/mouse/trackpad input), `IOConsoleLocked`, and the console user. Nothing runs on the client, so there's no client setup; a sleeping client just stops answering.
- **Debounce:** **online** after ≥ 90s of continuous activity (input within the last minute, unlocked), so a brief wake doesn't count. **Offline** when locked, unreachable 3 polls in a row (asleep / off Tailscale), or no input for 15 min. Short idle stretches (reading) stay online. While a `ag-client-cua` job runs on the client, its synthetic input is ignored (state held, arrival streak reset).
- **Arrival:** on each offline → online transition it runs `ag-tickler fire`, which launches the `when online` items queued before that arrival (plus the every-minute backstop). `ag-tickler fire` takes a lock so the two runs can't double-fire.
- State: `~/.local/state/ag-presence/state.json` (`state`, `online_since`, `last_seen`, `idle_s`, …); transitions in `log.jsonl` beside it. launchd output: `/tmp/ag-presence.log`. State older than 5 min reads as `unknown` (poller not running).
- Not detected: the user on the phone only, or at a client not in `machines/README.md`. Jump Desktop input from ag into the client would count as presence.

## Activity capture (time review)

Metadata only, for reviewing where the user's time and effort go. Nothing polls on its own: client events are event-driven, and ag piggybacks on the ag-presence poll. Everything is JSONL in `~/.local/state/activity/` on ag.

| File (on ag) | Written by | What |
| --- | --- | --- |
| `client-<client>.jsonl` | client Hammerspoon `activity_log.lua` → pulled by `ag-presence poll` | `hs_start` (login/reload, with boot time), `lock`/`unlock`, `sleep`/`wake`, `screens_off`/`on`, `session_active`/`inactive`, `power_off`, `screensaver_on`/`off`, `app_launch`/`app_quit`/`app_front` (app, bundle id, front window title ≤160 chars) |
| `ag.jsonl` | `ag-presence poll` (one `ps` per poll; `lsof` + `tailscale status` only for a new process) | `mux_attach`/`mux_detach`: which device has Ag's tmux attached (`via` = `ssh` for the client's `ag` command, `mosh` for Moshi, `local`), with Tailscale IP → device name |
| `injections.jsonl` | `ag-inbox`, `ag-tickler`, `ag-file-inbox` | a 12-char SHA-1 of every prompt they inject with `ag-mux agent prompt`, plus their id |
| `prompts.jsonl` | Pi extension `activity-log.ts` | one line per prompt: session file, cwd, ag-mux IDs at session start (`mux_start`), `origin` (`typed` / `ag-inbox` / `ag-tickler` / `ag-file-inbox` / `rpc` / `extension`, by matching the injection hash), attached devices, client presence and HID idle seconds. No prompt text (the session file has it). Private sessions (`ag-pi-private`, `~/private-chat`) are skipped. |
| `state.json` | `ag-presence poll` | pull offset into the client log, currently attached tmux clients (`clients`) |

The ag-inbox also logs `from` on each `received` capture in `~/.local/state/ag-inbox/log.jsonl`: requester IP (Tailscale device), declared `source` (`iphone`), the Mac's front app/window, and user agent.

- The client keeps its own `~/.local/state/activity/events.jsonl`; ag copies new complete lines each poll (≤256 KB per poll) and restarts from 0 if the client file shrinks. While the client is asleep, events queue there and arrive on the next poll.
- Limits: tmux doesn't say which attached client typed a keystroke, so `typed` prompts carry the attached devices plus the client's idle time. A prompt one agent sends to another with `ag-mux agent prompt` also reads as `typed`; a large client idle time with no phone attached marks it as probably not the user. Window titles only update when the app changes (switching tabs inside one app isn't logged).

## Prompt origins

Every prompt Ag writes into a session on someone's behalf carries its routing context in one tag rather than prose, so the text the user reads is just the message: `<ag-origin kind="report" label="Report from" title="Fix Ag Inbox" sid="01a1…">terse note for the model</ag-origin>`. The model reads the tag whole; AG Dash (server-side `parseOrigins` in `ag-dash`; chips in `chat.html` and `index.html`) and Pi's transcript (`pi/dot-pi/agent/extensions/ag-origin.ts`, a markdown transformer) strip it and show a chip: `label`, then `title` linked to `sid`. Helpers: `originTag`/`parseOrigins`/`promptGist` (TypeScript, ag-origin.ts) and `origin_tag`/`origins_of`/`strip_origins` (aglib.py). Kinds: `follow` and `hint` (ag-inbox follow-on routing), `playbook`, `share`, `screenshot` (ag-inbox), `spawn` (`ag spawn`'s report-back footer; `ag report` finds the parent from it), `report` (`ag report`), `send` (`ag send` from an agent session), `note` and `rule` (ag-rules square-brackets), `ag-tickler` (every ag-tickler fire; the task is the visible text), `comment` (phone review comments, ag-file-inbox), `dash` (AG Dash's Waiting-for nudge). Models that name or route sessions (ag-tab-name, Jev's follow-on match) read `promptGist`: the text with each chip on top.

## Jev (TypeSafe System One model)

Guide for agents. Sources: [docs.typesafe.ai](https://docs.typesafe.ai/llms.txt) (source of truth; append `.md` to any page path) and the official skill, vendored at `agents/dot-agents/skills/typesafe-ai` (from [typesafe-ai/skills](https://github.com/typesafe-ai/skills)). Read the live docs before writing an integration; details below are from jev-1.13 (Sep 2026).

**What it is.** A fast decision model, not a chat LLM. You send a `state` (text, JSON object, or array) plus named typed questions; it returns typed answers with calibrated probabilities. It does not generate text, call tools, or write code, so it can't power pi or any coding agent. Use it *inside* code wherever the answer has a known shape: route, gate, score, verify.

**Where Ag uses it** (all `jev-latest` over TrueFoundry, `TFY_TOKEN`). Each is a default ag-rule (`ag-rules/`), so its question, criteria and thresholds are readable and replaceable (`ag-rules eject <name>`):

| Where | Question | Effect |
|---|---|---|
| `ag-inbox` → `matchThread` (ag-rule `inbox-follow-on`, hook `capture`) | `noul`: does the capture refer back to ongoing work? `choice`: which open session is it for (or none)? | Delivers it into that session (follow) or names it in the new session's prompt (hint) |
| `ag-dash` → `/api/new` (ag-rule `new-item-intent`, hook `new-item`) | What is the New item box text for: find an existing session, or work for an agent? | Opens the session, or starts a new Inbox session |
| `ag-dash` → `judgeDone` (ag-rule `ag-dash-judge-done`, hook `answer`) | Does the latest answer of a chat archived while working leave anything for the user? | Marks the card Resolved (and closes it) |
| `ag-client-cua-gate` (via `ag-client-cua`, `ag cua --client/--phone`, the `ag-client-cua-guard` Pi extension; ag-rule `ag-client-cua-gate`, hook `cua`) | Is this action client-only, and does the command drive the desktop? | Allows the client/phone run, or blocks it and opens an access session |
| `ag-tab-name` (Pi extension; ag-rule `tab-name-fit`, hook `tab-name`) | Does the tab label still name the session? | Renames the tab with a fast LLM when it doesn't |

**Split the work.** If the step creates text or plans, keep it on an LLM. If it picks from a list, scores on a rubric, or answers yes/no, use Jev. Keep exact rules, lookups, and execution in plain code.

**API.**

```bash
# Through our TrueFoundry gateway ($AG_AI_GATEWAY, in ~/ag-personal/env; no TypeSafe key needed). The path after
# /proxy-api/jev-account/jev-endpoint/ is passed straight through to api.typesafe.ai.
curl -s "$AG_AI_GATEWAY"/proxy-api/jev-account/jev-endpoint/v1/systemone \
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
  - `pi/dot-pi/agent/extensions/ag-tab-name.ts`: keeps tab names accurate (`noul`: does the label still fit the recent prompts?; see "Session config").
  - `ag-inbox` screenshot gate: `noul`, does the capture need the screenshot? (see "ag-inbox").
  - `ag-inbox` follow-on routing: `noul` (refers to ongoing work?) + `choice` over open sessions and `none`, to deliver a capture into the session it continues (see "ag-inbox"). A worked example of the "pick from a list with a no-match option" pattern; with 60+ options, including each session's latest prompt noticeably raised the right answer's probability.

## Moshi (iPhone terminal)

Moshi on the iPhone connects to the session host over Tailscale and attaches to Ag's tmux.

- **Hook daemon**: `install` runs `ag-moshi-hook-install`. It installs the
  checksum-verified prebuilt `moshi-hook` into `~/.local/bin`, because the
  Homebrew formula refuses to install when the Command Line Tools lag behind macOS.
  The daemon runs from `macos-launchagents/com.ag.ag-moshi-hook.plist`
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
- **Session deep links**: `ag-session-link` prints the session's ag-dash link for the phone,
  `https://ag.<tailnet>.ts.net:7377/<pi session id>` (full name + https so iMessage linkifies it).
  To jump into a session in Moshi, open `http://<ag>:7374/m/<pi session id>`,
  where `ag-file-inbox` resolves the session's current pane (it survives pane moves),
  selects that tab in the `ag` tmux session server-side and 302s to `moshi://tmux?session=ag`, which resumes Moshi's
  already-open ag card (Moshi can't open a new connection from a link).
  The http hop exists because iMessage doesn't linkify `moshi://`.
- **Phone texts when agents finish**: `pi/dot-pi/agent/extensions/ag-notify.ts` texts
  `✅ Done` or `⚠️ Attention needed` + tab name, a one-line "what happened / what to do"
  headline (fast LLM), and the `ag-session-link`, when a turn ends while the user is away
  (`ag-presence`) or after a turn of 2+ minutes. `AG_NOTIFY=always|off` overrides per session.
  Sent by `ag-text`: Telegram bot "ag" (handle in the personal instructions) if Keychain items `ag telegram bot`
  (token) and `ag telegram chat` (chat id) exist, else `~/.config/ag/telegram` (0600,
  `token=`/`chat=`; what ag-engine and ag-mac use, since ag-mac's Keychain is locked over SSH),
  else iMessage from the client Mac (needs it awake). Recovery copy: `op-shared` item
  `ag telegram bot` (token + chat id). Telegram tasks (BotFather, reading chats) run in
  **Telegram.app on ag-mac**, which must stay signed in to the user's account; if it shows the
  QR login screen, the user scans it once from their phone (Telegram → Settings → Devices →
  Link Desktop Device). Never drive the client's Telegram or iPhone Mirroring for this.
  Log: `~/.local/state/ag-notify/log.jsonl`.
- **Telegram follow-ups**: when the user replies to an ag text in Telegram, `ag-telegram listen`
  (`ag-telegram.service`, session host) prompts the session that sent it (`ag-text` logs
  message id → session in `~/.local/state/ag/telegram-sent.jsonl`); a reply whose session is
  unreachable goes to the ag-inbox (routed). A plain message (not a reply) always opens a new
  Inbox session (`/prompt?new=1`). The agent then marks their message: `ag telegram done <id>` (👌,
  completed) or `ag telegram more <id> "context"` (✍ plus a threaded reply). Bots can't react
  with ✅/➡️ (Telegram's fixed reaction set). Log: `~/.local/state/ag/telegram-log.jsonl`.
- **Telegram status emoji**: ag-notify's own texts carry a status that is edited in place (no new
  ping, since reactions can't be ✅/🔄/➡️): 🔄 when the user comes back to that session and a turn
  starts, ✅ or ⚠️ when it ends, ➡️ once the session sends a newer text. `ag-text` with
  `AG_TEXT_KIND=notify` logs the text so `ag telegram status|supersede` can rewrite the header;
  state in `~/.local/state/ag/telegram-status.json`.
- **Shortcuts**: the same prefix chords as the Mac, per
  [`tmux/SHORTCUTS.md`](../tmux/SHORTCUTS.md): `Ctrl+B` + key (terminals don't send Cmd to tmux).
- **Line breaks**: Shift+Tab inserts a newline in Pi (Moshi's Shift+Enter arrives
  as plain Enter). Set in `pi/dot-pi/agent/keybindings.json`, so it applies on every
  client; thinking-level cycling moved from Shift+Tab to Alt+T. Open Pi sessions need `/reload`.

## Session config

Tab names stay accurate on their own (`pi/dot-pi/agent/extensions/ag-tab-name.ts`). On every prompt, in the background: a default numeric tab gets named by a fast LLM; otherwise Jev scores whether the label still fits the last 3 prompts, and if P(accurate) < 0.6 the LLM renames it. Renaming a tab by hand pins it for that session. Decisions are logged to `~/.local/state/ag-tab-name/log.jsonl` (label, `p_accurate`, keep/rename) for tuning the threshold. Open pi sessions need `/reload` to pick up changes.

`tmux/dot-config/ag/ag.tmux.conf` stows to `~/.config/ag/ag.tmux.conf` (Ag's server `tmux -L ag`; it sources
`~/.tmux.conf` first). Apply changes with `ag-mux server reload-config`. agd's state, sockets and layout live in
`~/.local/state/ag-mux/` and stay local. Design and internals: [docs/ag-mux.md](ag-mux.md).

- One flat list of tabs, all in the tmux session `ag` (no workspaces); each attached terminal gets its own view.
- Status bar: the tabs (⚠ blocked, … working, ● finished and unseen). `prefix+s` opens the switcher (every tab,
  most recent first).
- Pane env: `AG_MUX=1`, `AG_MUX_SOCKET`, `AG_TAB_ID`, `AG_PANE_ID`. A pane keeps its ID when it moves to another
  tab, so only `AG_TAB_ID` goes stale; resolve the live location with `ag-mux pane current` (or `ag me`).
- Agent state hooks report to agd: `pi/dot-pi/agent/extensions/ag-agent-state.ts`, `claude/` (`hooks/ag-agent-state.sh`
  + the `settings.json` hook), and `codex/` (`ag-agent-state.sh`, `hooks.json`).
- Shortcuts: canonical list and per-device behavior in
  [`tmux/SHORTCUTS.md`](../tmux/SHORTCUTS.md) (spec: the ag-rule `ag-session-keys`, verified by `ag-shortcuts-check`).

## Memory watch

`bin/dot-local/bin/ag-mem-watch` (LaunchAgent `com.ag.ag-mem-watch`, every 5 min, all
machines) logs a memory sample to `~/Library/Logs/ag-mem-watch.log` and notifies the user
(at most hourly per alert) when macOS memory pressure is warn/critical, swap in use
is >= 8 GB, or a single process holds >= 3 GB. Alerts from the host go to the
client's notifications (over SSH) plus a tmux toast. Run `ag-mem-watch` for a status
table of every machine. Thresholds: `MEMWATCH_SWAP_GB`, `MEMWATCH_PROC_GB`.

## Pi session hibernation

Idle pi sessions cost ~100-200 MB each, and dozens stay open as GTD items. Like
Chrome's tab discarding, `bin/dot-local/bin/ag-pi-hibernate` (LaunchAgent
`com.ag.ag-pi-hibernate`, KeepAlive, only on ag) stops idle ones and wakes them on
demand: every 10 min it hibernates pi panes whose agent state is `idle` (`done` keeps
its badge), that aren't focused, whose session file is
unchanged for 2 h (30 min under macOS memory pressure), and whose pi has no child
processes besides MCP helpers. The pane then shows a sleep screen; focusing the pane
(the daemon watches agd's focus events) or pressing any key runs
`pi --session <file>`, restoring the full conversation. Ctrl+C on the sleep screen
drops to a shell. Manual: `ag-pi-hibernate sweep [-n] [--all]`, `ag-pi-hibernate pane <id>`,
`ag-pi-hibernate status`. Thresholds: `PI_HIBERNATE_IDLE_MIN`,
`PI_HIBERNATE_PRESSURE_IDLE_MIN`. Log: `~/.local/state/ag-pi-hibernate/log`. Scrollback
and in-flight process state don't survive; the conversation does.

**Chrome on ag** (agents leave tabs open): Memory Saver is ON at **Maximum**
(chrome://settings/performance, GUI-only; set 2026-09-28), so inactive tabs are unloaded.
`bin/dot-local/bin/ag-chrome-tab-reaper` (LaunchAgent `com.ag.ag-chrome-tab-reaper`, every
30 min, only on ag) closes tabs that haven't been the active tab of their window for 12 h
(`CHROME_TAB_REAPER_HOURS`); never a window's active or last tab. `ag-chrome-tab-reaper
status` shows ages, `ag-chrome-tab-reaper log` lists closed URLs. Apple Events from
LaunchAgents hang without a grant, so sweeps run through `~/Applications/ag-chrome-tab-reaper.app`
(built by `macos-apps/ag-chrome-tab-reaper/install.sh` in `install`). **After a fresh build,
grant it:** run `ag-chrome-tab-reaper sweep` and click Allow on "ag-chrome-tab-reaper wants access
to control Google Chrome" (System Settings → Privacy & Security → Automation). The
prompt lives in UserNotificationCenter, which CUA can't touch; Hammerspoon can press it
via `hs.axuielement`. ag also allows `sshd-keygen-wrapper` → Google Chrome, so scripts
run by agents (started over SSH) can drive Chrome with osascript.

## Pi sessions archive

`ag-pi-sessions-sync` copies every Pi session transcript to the user's private GitHub: repos
`<owner>/pi-sessions-NNN` ("volumes"), laid out as `machines/<machine>/<project>/<session>.jsonl`.
Design notes: `docs/ag.md` ("pi-sessions archive").

- **Redacted, then encrypted.** Token and key patterns, payment cards (issuer prefix + Luhn) and
  `key = "value"` secrets become `[REDACTED:<kind>]`, then git-crypt encrypts everything under `machines/`.
  The key is base64 in 1Password, ag-vault "pi-sessions git-crypt key". To read the archive:
  clone it, `op-work item get "pi-sessions git-crypt key" --vault ag-vault --fields password --reveal | base64 -d > key`,
  then `git-crypt unlock key`.
- **When:** hourly, only for sessions untouched for 60 minutes (a live session is archived once it
  settles, then again whenever it changes). On the host, LaunchAgent `com.ag.ag-pi-sessions-sync`
  archives ag-mac plus the client, pulled over SSH (the client holds no vault credentials). On Ag Linux
  machines, the `ag-pi-sessions-sync.timer` systemd user unit archives that machine. Log on ag: `/tmp/ag-pi-sessions-sync.log`.
- **Volumes:** at about 4 GB a new private volume is created and the old one archived. The newest
  volume holding a file has its latest version. Pushes go in batches of about 400 MB.
- **State** (clones, index, remote mirrors): `~/.local/state/pi-sessions/`, on the engine's /data volume.
- **Separate from Nessie,** which syncs company-paid traces to the company. OpenRouter sessions under
  `~/private-chat` aren't archived.

## Ag state archive

Everything needed to rebuild Ag is on GitHub: code and config in ag, dotfiles and ag-personal, Pi transcripts
in pi-sessions-NNN (above), and the rest of the session host's state in the private repo `<owner>/ag-state`,
written by `ag-state sync` (`ag-state-sync.timer`, every 15 min, session host only).

- **What's in it** (`machines/<machine>/home/`, mirroring `$HOME`): `~/.local/state` (ag-mux layout and IDs,
  ag-tickler items, ag-dash pins/waiting/archive, ag-inbox, presence, routines, service logs), `~/inbox`,
  `~/review` and `~/.pi/todos`. Not: pi-sessions (own archive), sockets, locks, pids, ag-pi-hibernate's runtime
  files, files over 95 MB. No credentials: those come from 1Password and the bootstrap secrets checklist.
  New services that keep state under `~/.local/state/<name>/` are picked up automatically.
- **Encrypted** with git-crypt, same key as pi-sessions (ag-vault "pi-sessions git-crypt key"). Encrypted
  blobs don't delta-compress, so `main` is force-pushed as one snapshot commit per run and `history` gets one
  commit per day.
- **Rebuild:** `bootstrap-linux` on a fresh session host (no `~/.local/state/ag-mux/layout.json`) runs
  `ag-state restore` before starting agd, which pulls the state and then the Pi transcripts from every
  pi-sessions volume (newest wins; `--update` keeps newer local files). agd then restores the tabs asleep.
  By hand: `ag-state restore [--force] [--ref history~N] [--no-sessions] [--to DIR]`.
- **Gaps:** transcripts younger than about an hour (pi-sessions waits 60 quiet minutes) come back missing or
  short, and so does state written since the last 15-minute snapshot. Uncommitted work in repo checkouts and
  worktrees isn't covered: push it.

## Shared MCP gateway (Pi)

Pi's stdio MCP bridges (`linear`, `arcade_school`, `honeycomb`, `tsa_courses`) run
**once per machine** instead of once per Pi session: `bin/dot-local/bin/ag-mcp-gateway`
(LaunchAgent `com.ag.ag-mcp-gateway`, KeepAlive, all machines) runs each server's
`mcp-remote` behind its own pinned `mcp-proxy` (via `uvx`) on
`127.0.0.1:7381`–`7385/mcp`, and `pi/dot-pi/agent/mcp.json` points at those URLs
(`slack` stays direct HTTP). Per-session bridges cost ~100 MB each (96 sessions used
~9.5 GB on ag). Server commands and ports live in the script; logs in
`$TMPDIR/ag-mcp-gateway/<server>.log`. Check with `ag-mcp-gateway status`. After editing
it, `launchctl kickstart -k gui/$UID/com.ag.ag-mcp-gateway`; open Pi sessions
reconnect on their own.

## Slack MCPs (two work workspaces)

- `slack` is Slack's official MCP (`https://mcp.slack.com/mcp`, OAuth) in the user's primary
  work workspace, as the user's work account.
- `slack_alpha` reaches a second work workspace (team `<team>`, from
  `$AG_SLACK_ALPHA_TEAM` or `~/ag-personal/env`), which hosts the partner's Arcade channel. Slack's official MCP app isn't installed there, so
  it runs [`slack-mcp-server`](https://github.com/korotovsky/slack-mcp-server) `@1.3.0` in the shared
  MCP gateway (port 7385) on the Slack desktop app's own session on ag (the user's own user).
  Tools include `conversations_history` / `_replies` / `_search_messages` and
  `conversations_add_message` (posting as the user).
- Setup on ag: sign the Slack desktop app into that workspace (the user signs in), then run
  `ag-slack-session-auth store`. It reads the app's `xoxc` token and decrypts its `d` cookie (Keychain item
  `Slack Safe Storage`; first time, macOS asks for ag's login password, which agents fill from
  `ag Mac login`; `security` was given Always Allow), keeps the token whose `auth.test` is that workspace, and
  stores Keychain items `ag Slack <team> xoxc` / `xoxd`. Then
  `launchctl kickstart -k gui/$UID/com.ag.ag-mcp-gateway`. `ag-slack-session-auth check` tests them.
  If the desktop app signs out of it, the session dies: sign in again and rerun `store`.
- Only ag has the session; on other machines `slack_alpha` idles (no Keychain items).

## arcade_school MCP

The `arcade_school` MCP bridges to the partner's MCP endpoint; its credential file is `~/.config/mcp/arcade-school.headers`, never tracked.
Details (endpoint, provisioning, database access) are in the user's personal instructions.

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

Agents hand the user QA walkthroughs as video, not just screenshots. Both helpers write H.264/yuv420p
mp4s with faststart, so they play in QuickTime and inline on iPhone Safari.

- **Headless**: `ag-record-flow <url> [flow.ts] [-o out.mp4] [--mobile] [--storage state.json] [--trace]`
  records a Playwright flow (Storybook story URL, staging, a local dev server). `flow.ts`
  default-exports `async ({ page, context, pause }) => { … }`; use `pause(ms)` between steps so a
  viewer can follow. `--storage` takes a Playwright storageState, e.g. a signed-in staging session.
  Playwright is installed on first run into `~/.cache/ag-record-flow` (pinned; Chromium auto-installs),
  independent of any repo. If the flow throws, the video up to the failure is still saved.
- **Desktop**: `ag-screen-record start [-w "Google Chrome"]` … `ag-screen-record stop` (prints the mp4)
  records ag's main screen, or crops to one app's front window, while `ag-chatgpt-cua` drives it.
  ffmpeg avfoundation, 15 fps, capped at 30 min. Needs macOS **Screen Recording** for the agents'
  TCC identity, `sshd-keygen-wrapper` (see "macOS permissions for agents"); `start` fails fast
  when it's missing. Plain `screencapture -x out.png` works for single frames the same way.
- **Polished (Screen Studio style)**: `ag-rec start [-s N] [--fps 30]` … `ag-rec stop` records a
  screen *without* the cursor (`-capture_cursor 0`, wall-clock timestamps so `ffmpeg.log`'s
  `start:` is the first frame's epoch) while `cursorlog` (`share/ag-rec/cursorlog.swift`, a
  listen-only CGEvent tap for clicks plus 60 Hz position polling; needs Input Monitoring) writes
  `cursor.csv` into the session dir (`/tmp/ag-rec/<time>/`). `ag-rec export [dir] out.mp4`
  (`share/ag-rec/export.py`, a uv script with numpy + OpenCV) then: scores per-frame pixel change
  on a small gray copy; fast-forwards stretches with no change, cursor motion, or clicks for
  ≥1.2 s at 8x with a ⏩ badge (capped at 1.5 s of output each; `--drop` cuts them), keeping
  0.4 s before / 0.6 s after every change; turns instant cursor jumps into eased glides ending at
  the jump and smooths the rest (zero-lag 30 ms gaussian); draws a 1.5x macOS-style cursor with a
  press squish and click ripples; and spring-zooms (1.6x) toward click areas, holding through
  short gaps. `--plain` gives an unpolished reference. A 72 s Finder test exported to 25 s
  (20 s with `--drop`) in ~30 s.
- **Showing it**: `ag-show clip.mp4` opens it on the client and publishes a phone player page
  (`phone:` link). In review pages, keep the page self-contained for images (base64) but put videos
  beside it as files, `<video src="flow.mp4" controls playsinline muted>`: `ag-show page.html` copies
  referenced `src`/`poster` files along. `ag-file-inbox` serves byte ranges, which iPhone Safari needs.

## macOS permissions for agents (TCC)

macOS attributes a process's privacy access (TCC) to its *responsible* process. On ag-mac
agent commands arrive over SSH (`ag-mac run` from ag-engine, `ssh ag-mac`), so **every agent command
on ag-mac runs as `/usr/libexec/sshd-keygen-wrapper`**: not Ghostty, pi, ffmpeg, or osascript. Grant things to that one Apple-signed binary;
its identity survives macOS and Homebrew updates (a grant to a Homebrew Cellar path or an
ad-hoc-signed binary breaks on every upgrade). Launchd jobs (`launchctl submit`,
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
  a new identity still alerts once (it may name the process, e.g. "ffmpeg", while the approval is
  stored under sshd-keygen-wrapper): `ag-access allow`, then `ag-screen-approvals`.
- An idle display keeps recording but serves duplicate frames: wake it with `caffeinate -u -t <s>`
  before recording (ag-headless-display keeps a virtual display, not an awake one).
- Grants on ag-mac (2026-09-29), all to `sshd-keygen-wrapper`: Full Disk Access, Accessibility,
  Screen & System Audio Recording (System Settings → Privacy & Security → the list → + →
  Cmd+Shift+G `/usr/libexec/sshd-keygen-wrapper`), plus Automation for System Events, Finder,
  Messages, Chrome (Contacts stays denied: its toggle ignores clicks; fixing it needs
  `tccutil reset AppleEvents com.apple.sshd-keygen-wrapper` and re-allowing each target). There's no MDM (checked `profiles status`), so a PPPC profile
  can't pre-grant these; MDM couldn't pre-allow Screen Recording or Input Monitoring anyway.
  New Automation targets prompt on first use: `ag-access allow`.
- A command started from a local Ghostty on ag-mac instead of over SSH inherits Ghostty's grants
  (Screen Recording and Accessibility, no Full Disk Access). Run it over SSH to get the full set.
- Keychain "Allow" prompts are per item: create items agents read with
  `security add-generic-password -T /usr/bin/security …` so the CLI is on the item's ACL.

## Client ↔ ag bridge

The user sits at a client machine; agents run on a host (ag). Every machine stows this repo; roles and aliases are in `machines/README.md`.

- **SSH**: `ssh/dot-ssh/config` defines an alias per machine (Tailscale IPs). Each machine needs an
  `~/.ssh/id_ed25519` authorized on the machines it talks to (manual, per device), and Remote Login on.
  Machine-only hosts go in untracked `~/.ssh/config.local`.
- **Screenshots → ag**: CleanShot X on the client saves to `~/Screenshots` (Settings → General →
  Export location; after-capture actions include *Save*). Set by hand/CUA; CleanShot stores it as
  `exportPath` in `pl.maketheweb.cleanshotx` and needs a restart to apply. `ag-shot [n]` on ag pulls
  the newest n into `~/inbox/shots`.
- **Perplexity voice off**: on the client, Perplexity Settings → Keyboard Shortcuts → *Start voice* is
  **Disabled** (default was *Hold Fn*, which fired on Ctrl/Fn), and General → Voice → Activation is
  Disabled. Stored as `voiceTriggerMode = disabled` in `ai.perplexity.macv3`. Set by hand/CUA.
- **Paste images into agents**: Hammerspoon (client only). Every CleanShot capture is uploaded to
  `ag:~/inbox/clipboard/` the moment CleanShot writes it (it watches CleanShot's media folder and
  `~/Screenshots`), so Cmd+V in an Ag Ghostty window (title `ag: …`) just types the already-uploaded ag path
  (instant); pi attaches image paths. Other clipboard images/files upload on paste (path typed first).
  Uploads reuse one SSH connection (`ControlMaster` in `ssh/dot-ssh/config`). Text pastes untouched.
  Speed limit: on the office network the machines sit behind the same symmetric NAT, so Tailscale
  relays via DERP (~1.3 MB/s; a ~1 MB screenshot lands in ~0.8s). Check with
  `tailscale ping ag-client` (want "via <ip>", not "via DERP").
- **ag → client viewing**: `ag-show <file|dir|url>` copies to client `~/ag-inbox` and opens it there
  (HTML files bring their referenced local assets; a folder opens its `index.html`).
  Agents call it themselves (see AGENTS.md). Servers on ag are reachable at `http://ag:<port>`.
- **Reviewing on the phone**: on ag, `ag-show` also publishes HTML pages, folders, and Markdown
  (rendered with pandoc) to `~/review/<name>/` and prints `phone: http://ag.<tailnet>.ts.net:7374/r/<name>/`.
  `ag-file-inbox` serves them to the tailnet, adding a phone viewport and a **Comment** button to HTML.
  A comment posts to `/r/<name>/comment` and is sent as a prompt to the pi session that ran `ag-show`
  (matched by `$PI_SESSION_FILE` in `~/review/<name>/.meta.json`, so it survives pane moves), with
  the section heading he was reading. If that session is gone, it opens a new Inbox session.
  Nothing is exposed beyond Tailscale. Old pages in `~/review` can be deleted anytime.
- **`ag cua` (`ag-cua`) is the one computer-use command** (Pi tool `ag_cua`). It routes by target:
  ag-mac's desktop by default (`ag-chatgpt-cua` locally on ag-mac, `ag-mac cua` from anywhere else, both
  queued as below), `--client --why …` to the client Mac and `--phone --why …` to the iPhone via
  iPhone Mirroring (both `ag-client-cua`, gated by `ag-client-cua-gate`). `ag cua --status|cancel|attach`
  wrap `ag-screen-queue`. The scripts below are its internals; agents only call `ag cua`.
- **The screen queue** (`ag-screen-queue`, formerly `ag-screen-queue`; front end `ag screen`): the screen is the
  scarce resource, so every job that acts on a Mac's screen runs one at a time on that Mac's queue. Two job
  kinds: `cua` (a computer-use run) and `exec` (a shell command that clicks, types or raises windows).
  Each Mac with a screen runs its own queue (ag-mac's; the client's, which also serves the mirrored iPhone);
  Linux machines forward to ag-mac's. State: `~/.local/state/ag-screen-queue/` (moved from `ag-screen-queue/`,
  which is left as a symlink).
  Every `ag-chatgpt-cua` run on ag-mac (the `chatgpt_cua` Pi tool, `ag-mac cua` from the engine, local
  calls) is a job in `~/.local/state/ag-screen-queue/jobs/<id>/` (task, caller, status, log, report, rc).
  A detached runner per job waits for its turn (FIFO, one `zsystem flock` lock), then runs
  `ag-chatgpt-cua` with `CUA_QUEUE_INNER=1`; the caller only watches and streams "queued behind
  <caller>, N ahead" / "running (Xs)" to stderr. `ag-screen-queue list` (`ag-mac cua --status`,
  `ag-chatgpt-cua --status`; works from the engine too) shows the running job, the queue, and recent
  results. `ag-screen-queue cancel <id>` drops a queued job or stops a running one (its cleanup still runs);
  `ag-screen-queue attach <id>` waits for a job and prints its report. A caller that is stopped
  (SIGTERM/INT/HUP: the Pi tool aborting, Ctrl-C on `ag-mac cua`) cancels its own job; one that vanishes
  silently (SSH dropped) abandons its job if it hadn't started, while a started job finishes and stays
  attachable. Jobs whose runner died are marked `lost` so they never block the queue. Pi's tool labels
  jobs with the session name and its ag-dash link (`CUA_CALLER`) and picks the id (`CUA_JOB_ID`).
  **Urgent jobs** (`ag_cua` `urgent: true`, `ag cua --urgent`, `CUA_URGENT=1`, `ag-screen-queue run --urgent`) go ahead of
  every non-urgent job and preempt a running one: the queue stops its codex, the inner `ag-chatgpt-cua`
  exits 75 without cleaning up, and the job becomes `paused` with its codex session id saved (from the
  log's `session id:` line). After the urgent job, the paused job resumes first with
  `codex exec resume <session>` (told the screen may have changed), against its original cleanup
  snapshot (kept in the job dir). Urgent jobs never preempt each other. ag-dash shows the queue in its
  header (a `CUA` pill; click for running/paused/queued jobs and recent results, with links to the
  calling sessions) next to an `engine mem` pill (ag-engine's `/proc/meminfo` used % and memory PSI;
  amber at ≥85% or ≥10% stall, red at ≥95% or any sustained full stall). The board reads
  `ssh ag-mac ag-screen-queue json` every 5 s.
- **Raw screen input goes through the queue too.** The next job starts the instant one ends, so nothing on
  screen survives between two jobs, and any keystroke or click sent outside a job lands in someone else's
  run. (2026-10-03: an agent typed a card number with `ag-mac run 'osascript … keystroke'` between its own
  CUA jobs; the queue had already started other sessions' Teams and Gmail jobs, so the digits went into
  their windows.) Enforcement is on the Mac itself: `osascript` and `cliclick` shims in `~/.local/bin`
  (first on PATH) send screen-driving calls (keystroke, key code, click, AXRaise/AXPress, perform action,
  activate, set frontmost; cliclick except `p`) through `ag-screen-queue exec`, however the command
  arrived (`ag-mac run`, plain ssh, a script). Read-only AppleScript runs directly. Inside a job
  (`CUA_QUEUE_INNER=1`) everything runs directly; `AG_SCREEN_OK=1` skips the queue on purpose (only
  `ag-access allow`, whose prompt may be what's blocking the running job). A shimmed script that types a
  value from its environment (`system attribute`, i.e. a secret) is refused outside a job, since the
  job can't inherit it. Each shimmed call is its own job, so run a multi-step sequence as one
  `ag screen exec '<script>'`, and do whole flows (focus, type, submit, check) in **one** CUA task.
  The client's computer-use runs (`ag-client-cua`) also take a slot on the client's queue (an exec job
  that `launchctl submit`s the GUI-session codex run and waits for it). Non-interactive ssh on the
  client doesn't put `~/.local/bin` first, so there only the queue and the client-CUA gate apply.
- **Secrets into fields: `ag-type-secret`.** To enter a password or card number, the CUA task itself
  runs `ag-type-secret [--app "Google Chrome"] op://<vault>/<item>/<field>` after focusing the field:
  it refuses outside a screen job, checks the frontmost app, reads via op-shared (machine-shared),
  op-work (ag-vault) or op-ag, and keystrokes it with the value in the environment (never argv,
  output, or the prompt). Never screenshot a filled secret field to check it; ask the CUA run whether
  the field is filled, without digits.
- **Client desktop automation**: `ag-client-cua --why "<reason>" "<task>"` runs Codex computer use on the
  client's GUI session (via `launchctl submit`; plain ssh can't see the screen). It's an antipattern,
  so it's gated: `ag-client-cua-gate` asks Jev (TrueFoundry, `TFY_TOKEN`) whether the thing exists only
  on the client (a dialog/permission prompt showing there, iPhone Mirroring, a client-only setting).
  Otherwise, or if Jev is unreachable, it blocks (exit 3) and POSTs an access session to the ag-inbox
  (`/prompt?new=1`, never a follow-on) to get the missing access onto ag; deduped per task (6h) and
  per blocked session (1h). Pi's `ag-client-cua-guard.ts` extension runs the gate before bash calls that
  invoke `ag-client-cua`, set `CLIENT_CUA_HOST`, or SSH to the client with osascript/Hammerspoon
  UI/cliclick, and passes a one-time `CLIENT_CUA_GATE_TOKEN` so it isn't judged twice.
  Log: `~/.local/state/ag-client-cua-gate/log.jsonl`.
- **Phone → ag**: `ag-file-inbox` (LaunchAgent `com.ag.ag-file-inbox`, port 7374, Tailscale only)
  saves uploads to `~/inbox/phone` and can prompt a recent pi session or open a new one. The iOS
  Shortcut is documented in `ios-shortcuts/send-to-ag.md`. Log: `/tmp/ag-file-inbox.log`.
- **Links to sessions**: `ag link [session…]` prints `Tab  http://ag:7376/<pi session id>`, a
  deep link into ag-dash (see "ag-dash"): the live card's drawer, or a hibernated/closed session's
  transcript with Wake / Resume. Session ids are stable. `--url` prints only the URL, `--phone` the https
  phone link. Plain http, since Ghostty only auto-links standard schemes.
