# ag-mux: Ag's session layer (tmux + agd)

Every Ag session (a Pi, Claude or Codex agent, a dev server, a shell) lives in **tmux** on the session host
(ag-engine), on a dedicated server `tmux -L ag`. A small daemon, **agd** (`ag-mux daemon`), adds what Ag
needs on top of plain tmux: stable tab/pane IDs, agent lifecycle states, snapshots, events,
notifications, and layout persistence. Everything else (ag-dash, the ag-inbox, the ag-tickler, ag-pi-hibernate,
ag-nav, the `ag` CLI, the agent hooks) talks to agd through the **`ag-mux` CLI** or agd's JSON-lines socket.

Code: `bin/dot-local/bin/ag-mux` (sh launcher), `bin/dot-local/lib/ag-mux/ag-mux.ts` (agd + CLI, Bun),
`bin/dot-local/bin/ag-mux-shell` (pane start-up), `tmux/dot-config/ag/ag.tmux.conf` (tmux config),
`systemd-user/dot-config/systemd/user/ag-mux.service`. Tests: `tests/ag-mux-smoke.sh`.

```text
 ag-client (Ghostty + Hammerspoon)      ag-phone (Moshi, mosh/ssh)
        │ ag = ssh -t ag-engine ag-mux attach   │ tmux picker / moshi://tmux
        ▼                                       ▼
 ┌──────────────────────── ag-engine ─────────────────────────┐
 │ tmux server  (tmux -L ag; config ~/.config/ag/ag.tmux.conf) │
 │   one session `ag`: window = tab, pane = pane              │
 │   user options: @ag_tab @ag_pane @ag_glyph @ag_sleep ...    │
 │        ▲ control-mode client (events)                      │
 │ agd  (Bun, systemd user unit ag-mux.service)               │
 │   · JSON-lines socket ~/.local/state/ag-mux/agd.sock        │
 │   · ID registry, agent state machine, seen/done tracking   │
 │   · snapshot cache, events.subscribe, layout persistence   │
 │ ag-mux CLI → agd socket                                    │
 │ ag-dash · ag-inbox · ag-tickler · ag-pi-hibernate · ag-nav       │
 └─────────────────────────────────────────────────────────────┘
```

## Model and IDs

- **One flat list of tabs.** Every tab is a window of a single tmux session, `ag`; pane = pane. There are no
  workspaces. Identity lives in `@ag_tab` / `@ag_pane`, never the window name, so renames are free.
- **Each terminal gets its own view.** `ag-mux attach` creates a session grouped with `ag` (same windows, its own
  current window, `destroy-unattached on`) and attaches to that, so the Mac and the phone don't drag each other
  between tabs. agd reads only `ag`'s rows to build its model; grouped views only tell it which tab each client
  is looking at. Any other session (made with plain tmux, or left from before the flattening) is folded into
  `ag` with `move-window`, keeping its processes, IDs and attached clients.
- agd mints IDs `t<n>` and `p<n>` (base-36, never reused; counters persisted in `~/.local/state/ag-mux/state.json`)
  and maps them to tmux's own `@`/`%` IDs (which reset when the tmux server restarts). IDs minted before the
  flattening look like `w3:t8` / `w3:p4` and keep working: treat IDs as opaque. Anything that takes a pane ID also
  accepts tmux's `%n`. A pane keeps its ID when it moves to another tab.
- Pane env (set by agd for panes it creates, and by `ag-mux-shell` → `pane register` for panes made with plain
  tmux keys): `AG_MUX=1`, `AG_MUX_SOCKET`, `AG_TAB_ID`, `AG_PANE_ID`. `AG_TAB_ID` goes stale when the pane moves
  to another tab; resolve the live location with `ag-mux pane current` (or `ag me`). Callers that identify their
  own pane use `AG_PANE_ID`, falling back to `TMUX_PANE`.

## Agent lifecycle

- States `idle` / `working` / `blocked` / `done` / `unknown`. `done` = finished while nobody was looking;
  focusing the tab marks it seen (`idle`). Pi's `blocked` comes from an `ag:blocked` Pi event.
- Agents push their own state: `pi/dot-pi/agent/extensions/ag-agent-state.ts` (Pi) and the shell hooks
  `claude/dot-claude/hooks/ag-agent-state.sh` / `codex/dot-codex/ag-agent-state.sh` call
  `pane.report_agent` and `pane.report_agent_session` (state + session file). The session file is the key ag-dash,
  `ag link`, the ag-tickler and ag-file-inbox use to find a session.
- `agent start` requires a pane at a shell prompt and waits for the agent's first report (`agent_not_ready` on
  timeout). `agent prompt` pastes (bracketed) and sends Enter; `--wait` requires `working` within 5 s (else
  `agent_prompt_stalled`), then waits for a settled state. Names follow `[a-z][a-z0-9_-]{0,31}`.

## The socket and CLI

`ag-mux <group> <command> …` prints JSON on stdout, errors as JSON on stderr (exit 1; usage errors exit 2).
`ag-mux --skill` prints a short agent skill. How each method maps onto tmux:

| Method | tmux / agd |
|---|---|
| `tab create/rename/focus/close` | `new-window -d [-c cwd]` in `ag` (`new-session` for the first tab), `rename-window`, `select-window` in the client's view, `kill-window` |
| `pane split/close/neighbor/layout` | `split-window -d -h/-v`, `kill-pane`, neighbours from `list-panes -F` geometry, `window_layout` |
| `pane move --new-tab` | a placeholder window + `swap-pane` (a single-pane tab is just renamed) |
| `pane run` / `send-text` / `send_input` | `load-buffer -` + `paste-buffer -p -d` (honours bracketed paste), then `send-keys Enter` |
| `pane send-keys` | logical keys → tmux names (`ctrl+c`→`C-c`, `esc`→`Escape`, …), validated before sending |
| `pane read visible/recent/recent-unwrapped`, `--ansi` | `capture-pane -p` / `-S -N` / `-J -S -N` / `-e` |
| `pane wait-output --match/--regex` | polls `capture-pane` every 200 ms (output already on screen matches too) |
| `pane process-info` | `pane_pid` + the `ps` tree; foreground = processes in the tty's `tpgid` |
| `report_agent`, `report_agent_session` | state + `@ag_*` pane options; bumps `state_change_seq`; emits `pane_agent_status_changed` |
| `session.snapshot` (`api snapshot`) | in-memory model refreshed from one `list-panes -a -F …` per event burst (and every 5 s) |
| `events.subscribe` | tmux control-mode notifications plus agd's own agent events |
| `notification show` | `display-message` on every client plus an OSC 9 passthrough, so Ghostty raises a macOS notification |
| `layout.export` | `window_layout` + per-pane cwd/session, as a binary split tree (ag-nav's reopen) |
| `server reload-config` | `source-file ~/.config/ag/ag.tmux.conf` |

Events come from a single control-mode client on a hidden `_agd` session (`refresh-client -f
no-output,ignore-size`), so it never resizes windows or counts as looking at anything. If control mode drops,
agd reconnects and rebuilds from `list-*`. Bare `ag-mux` / `ag-mux attach` attaches the terminal to its own
grouped view of `ag`; never run it from inside a pane.

## Persistence and restore

agd writes `~/.local/state/ag-mux/layout.json` on every structural change (debounced): tabs in order with
labels, each window's layout, and per pane its cwd, agent kind and session file. Restore also reads the older
version-1 file (tabs grouped under workspaces) and lays its tabs out flat.
`ag-mux restore [--from file] [--awake]` rebuilds it; agent panes come back as **sleep screens**
(`ag-pi-hibernate wait <file>`), not 100 Pis at once, and wake when their tab is focused. The same mechanism covers
tmux server crashes (agd restarts tmux and restores), reboots, and a rebuilt engine. `ag-mux.service` uses
`KillMode=process`, so restarting agd never kills sessions.

## Status bar, switcher, shortcuts

- **Status bar** (`ag.tmux.conf`): the tabs with state glyphs (⚠ blocked, … working, ● finished and unseen). agd
  keeps `@ag_glyph` current, so nothing runs per redraw. Click to switch.
- **Switcher** (`prefix+s`, `ag-mux switch`): every tab, needs-you first, then most recent change.
  **Find** (`prefix+f`, `ag-tab-find`): fuzzy search over tab names and contents.
- **Focus history** (`prefix+[` / `prefix+]`) and **reopen closed pane** (`prefix+u`): `ag-nav` (daemon
  `ag-nav.service` watching agd's focus events).
- Window title `ag: <tab>`: Hammerspoon on Mac clients forwards Cmd shortcuts as `Ctrl+B` chords
  only into Ghostty windows with that title, and uploads pasted images first. Canonical list:
  [`tmux/SHORTCUTS.md`](../tmux/SHORTCUTS.md) (spec: the ag-rule `ag-rules/ag-session-keys`, checked by
  `ag-shortcuts-check`).
- **ag-dash** (`http://ag:7376`) stays the real overview, on the Mac and the phone.

## Clients, focus, links

- `ag` on a client = `ssh -t <session host> ag-mux attach`. Every binding lives in the host's tmux config.
- `ag-presence` detects attached clients from `tmux -L ag attach-session` processes (via ssh, mosh or local) and logs
  `mux_attach` / `mux_detach` to `~/.local/state/activity/ag.jsonl`.
- `tab focus` selects the tab in the most recently active client's view, or the one named by `--client`.
- **Links** never name a tab: `ag link` prints the ag-dash deep link `http://ag:7376/<pi session id>`, which opens
  the session live, hibernated (Wake) or closed (Resume). tmux passes OSC 8 hyperlinks through.
- **Moshi** (iPhone): tmux is a first-class Moshi multiplexer (session picker, window swipes, mosh reattach).
  The board's 📱 button goes to ag-file-inbox `/m/<session id>`, which selects the pane's window in `ag` server-side
  and 302s to `moshi://tmux?session=ag` (Moshi's link only picks windows 0–9). Terminals don't send Cmd to
  tmux, so on the phone use the prefix chords.
- Inline images in panes (kitty graphics) aren't supported by tmux; images still show in ag-dash's transcript.

## Tests

`tests/ag-mux-smoke.sh` runs agd against an isolated tmux server and state dir (never the real `tmux -L ag`):
topology, pane I/O, moves, events, response shapes against the golden fixtures in `tests/fixtures`, restore, and
crash recovery. `AG_MUX_TEST_PI=1` adds a live Pi start/prompt. tmux 3.7 crashes on `break-pane` with no client
attached, which is why pane moves use a placeholder window and `swap-pane`.

## The `ag` address (Tailscale Service `svc:ag`)

User-facing links never name a machine. `ag` is the Tailscale Service **`svc:ag`**
(`ag.<tailnet>.ts.net`, short name `ag` via MagicDNS), advertised by whichever
machine hosts sessions (today ag-engine, `ag-svc local`):

| URL | What |
|---|---|
| `http://ag:7373` | ag-inbox (and the ag-tickler webhook) |
| `http://ag:7374` | ag-show / phone review / file inbox (`http://ag.<tailnet>.ts.net:7374/r/<name>/` for the phone) |
| `http://ag:7375` | private chat |
| `http://ag:7376/<pi session id>` | ag-dash deep links |
| `https://ag.<tailnet>.ts.net:7377` | ag-dash over HTTPS (voice needs it) |

Defined in `tailscale/policy.hujson` (autoApprover: `tag:ag-engine`) and via the API
(`ag-ts-api PUT tailnet/-/vip-services/svc:ag`, ports 7373–7377); `ag-svc local` / `ag-svc status`. The iOS Shortcuts
(`ios-shortcuts/`) post to `ag.<tailnet>.ts.net` too.

## Where services run

Every Ag service runs on the session host as a systemd user unit: `ag-mux` (agd), `ag-dash` (ag-dash),
`ag-inbox`, `ag-file-inbox`, `ag-private`, `ag-tickler`, `ag-presence`, `ag-pi-hibernate` (memory pressure from
`/proc/pressure/memory`), `ag-nav`, `ag-mcp-gateway`, `ag-pi-sessions-sync`, `nessie`, `ag-telegram`. ag-mac keeps only
the extremity role: computer use, Mac-only apps and CLIs, plus `ag-mem-watch`, `ag-headless-display`,
`ag-chrome-tab-reaper`, `ag-tfy-env` and the Nessie app as LaunchAgents.

## History

Until 2026-09-29 sessions ran on ag-mac under a different terminal multiplexer. On 2026-09-29 they moved to
ag-engine under tmux + agd in one cut-over: checkouts rsynced (uncommitted work, stashes and `.env` files
included), Pi session files and service state copied, the old layout exported and restored with Pi asleep, roles
flipped in `machines/README.md`, and `ag-svc local`. Verified with sha256 per file: 3,202 Pi session files, 173
service-state files and 1,335 `~/inbox`/`~/review` files identical; all 163 tabs back with the same workspace,
label and session file. Paths from ag-mac keep working on the engine: ag-mac's home path is a symlink to
the engine's home (`bootstrap-linux`).

On 2026-10-03 workspaces went away: every tab now lives in the one tmux session `ag` (agd folded the topic
workspaces' sessions into it with `move-window`, so processes and IDs survived), ag-dash's Projects and the Inbox
auto-filer were removed, and the Inbox became a state (a session the user hasn't replied to yet).
