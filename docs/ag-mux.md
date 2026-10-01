# ag-mux: Ag's session layer (tmux + agd)

Every Ag session (a Pi, Claude or Codex agent, a dev server, a shell) lives in **tmux** on the session host
(ag-engine), on a dedicated server `tmux -L ag`. A small daemon, **agd** (`ag-mux daemon`), adds what Ag
needs on top of plain tmux: stable workspace/tab/pane IDs, agent lifecycle states, snapshots, events,
notifications, and layout persistence. Everything else (AG Dash, the ag inbox, the tickler, pi-hibernate,
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
 │   session = workspace, window = tab, pane = pane           │
 │   user options: @ag_ws @ag_tab @ag_pane @ag_glyph ...       │
 │        ▲ control-mode client (events)                      │
 │ agd  (Bun, systemd user unit ag-mux.service)               │
 │   · JSON-lines socket ~/.local/state/ag-mux/agd.sock        │
 │   · ID registry, agent state machine, seen/done tracking   │
 │   · snapshot cache, events.subscribe, layout persistence   │
 │ ag-mux CLI → agd socket                                    │
 │ ag-board · ag-inbox · tickler · pi-hibernate · ag-nav       │
 └─────────────────────────────────────────────────────────────┘
```

## Model and IDs

- **Workspace = tmux session, tab = window, pane = pane.** Session name = label (sanitized; tmux forbids `:`
  and `.`); the real label lives in `@ag_ws_label`. Identity lives in `@ag_ws` / `@ag_tab` / `@ag_pane`, never
  the name, so renames are free.
- agd mints IDs `w<n>`, `w<n>:t<n>`, `w<n>:p<n>` (base-36, never reused; counters persisted in
  `~/.local/state/ag-mux/state.json`) and maps them to tmux's own `$`/`@`/`%` IDs (which reset when the tmux
  server restarts). Anything that takes a pane ID also accepts tmux's `%n`.
- A pane and its tab keep their IDs when the tab moves to another workspace (`move-window` keeps the process);
  the `w<n>` prefix just becomes historical.
- Pane env (set by agd for panes it creates, and by `ag-mux-shell` → `pane register` for panes made with plain
  tmux keys): `AG_MUX=1`, `AG_MUX_SOCKET`, `AG_WORKSPACE_ID`, `AG_TAB_ID`, `AG_PANE_ID`. `AG_WORKSPACE_ID` goes
  stale when a tab is filed; resolve the live location with `ag-mux pane current` (or `ag me`). Callers that
  identify their own pane use `AG_PANE_ID`, falling back to `TMUX_PANE`.

## Agent lifecycle

- States `idle` / `working` / `blocked` / `done` / `unknown`. `done` = finished while nobody was looking;
  focusing the tab marks it seen (`idle`). Pi's `blocked` comes from an `ag:blocked` Pi event.
- Agents push their own state: `pi/dot-pi/agent/extensions/ag-agent-state.ts` (Pi) and the shell hooks
  `claude/dot-claude/hooks/ag-agent-state.sh` / `codex/dot-codex/ag-agent-state.sh` call
  `pane.report_agent` and `pane.report_agent_session` (state + session file). The session file is the key AG Dash,
  `ag link`, the tickler and file-inbox use to find a session.
- `agent start` requires a pane at a shell prompt and waits for the agent's first report (`agent_not_ready` on
  timeout). `agent prompt` pastes (bracketed) and sends Enter; `--wait` requires `working` within 5 s (else
  `agent_prompt_stalled`), then waits for a settled state. Names follow `[a-z][a-z0-9_-]{0,31}`.

## The socket and CLI

`ag-mux <group> <command> …` prints JSON on stdout, errors as JSON on stderr (exit 1; usage errors exit 2).
`ag-mux --skill` prints a short agent skill. How each method maps onto tmux:

| Method | tmux / agd |
|---|---|
| `workspace create/rename/close` | `new-session -d`, `rename-session` + `@ag_ws_label`, `kill-session`; order from agd (Inbox first) |
| `tab create/rename/focus/close` | `new-window -d [-c cwd]`, `rename-window`, `switch-client` + `select-window`, `kill-window` |
| `pane split/close/neighbor/layout` | `split-window -d -h/-v`, `kill-pane`, neighbours from `list-panes -F` geometry, `window_layout` |
| `pane move --new-tab --workspace` | `move-window` for single-pane tabs (the auto-filer's case); a placeholder window + `swap-pane` otherwise |
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
agd reconnects and rebuilds from `list-*`. Bare `ag-mux` / `ag-mux attach [workspace]` attaches the terminal
(creating Inbox if the server is empty); never run it from inside a pane.

## Persistence and restore

agd writes `~/.local/state/ag-mux/layout.json` on every structural change (debounced): workspaces with labels
and order, tabs with labels, each window's layout, and per pane its cwd, agent kind and session file.
`ag-mux restore [--from file] [--awake]` rebuilds it; agent panes come back as **sleep screens**
(`pi-hibernate wait <file>`), not 100 Pis at once, and wake when their tab is focused. The same mechanism covers
tmux server crashes (agd restarts tmux and restores), reboots, and a rebuilt engine. `ag-mux.service` uses
`KillMode=process`, so restarting agd never kills sessions.

## Status bar, switcher, shortcuts

- **Two-line status bar** (`ag.tmux.conf`): line 1 = tabs of this workspace with state glyphs (⚠ blocked,
  … working, ● finished and unseen); line 2 = workspaces, Inbox first, with counts of tabs needing you. agd keeps
  `@ag_glyph` and `@ag_ws_line` current, so nothing runs per redraw. Click to switch.
- **Switcher** (`prefix+s`, `ag-mux switch`): every tab grouped by workspace, most recent change first.
  **Find** (`prefix+f`, `ag-tab-find`): fuzzy search over workspace/tab names and contents.
- **Focus history** (`prefix+[` / `prefix+]`) and **reopen closed pane** (`prefix+u`): `ag-nav` (daemon
  `ag-nav.service` watching agd's focus events).
- Window title `ag: <workspace> › <tab>`: Hammerspoon on Mac clients forwards Cmd shortcuts as `Ctrl+B` chords
  only into Ghostty windows with that title, and uploads pasted images first. Canonical list:
  [`tmux/SHORTCUTS.md`](../tmux/SHORTCUTS.md) (spec `tmux/dot-config/ag/shortcuts.json`, checked by
  `ag-shortcuts-check`).
- **AG Dash** (`http://ag:7376`) stays the real overview, on the Mac and the phone.

## Clients, focus, links

- `ag` on a client = `ssh -t <session host> ag-mux attach`. Every binding lives in the host's tmux config.
- `presence` detects attached clients from `tmux -L ag attach-session` processes (via ssh, mosh or local) and logs
  `mux_attach` / `mux_detach` to `~/.local/state/activity/ag.jsonl`.
- `tab focus` switches the most recently active client, or the one named by `--client`.
- **Links** never name a tab: `ag link` prints the AG Dash deep link `http://ag:7376/<pi session id>`, which opens
  the session live, hibernated (Wake) or closed (Resume). tmux passes OSC 8 hyperlinks through.
- **Moshi** (iPhone): tmux is a first-class Moshi multiplexer (session picker, window swipes, mosh reattach).
  The board's 📱 button goes to file-inbox `/m/<session id>`, which selects the pane's window server-side and
  302s to `moshi://tmux?session=<workspace>` (Moshi's link only picks windows 0–9). Terminals don't send Cmd to
  tmux, so on the phone use the prefix chords.
- Inline images in panes (kitty graphics) aren't supported by tmux; images still show in AG Dash's transcript.

## Tests

`tests/ag-mux-smoke.sh` runs agd against an isolated tmux server and state dir (never the real `tmux -L ag`):
topology, pane I/O, moves, events, response shapes against the golden fixtures in `tests/fixtures`, restore, and
crash recovery. `AG_MUX_TEST_PI=1` adds a live Pi start/prompt. tmux 3.7 crashes on `break-pane` with no client
attached, which is why pane moves use a placeholder window and `swap-pane`.

## The `ag` address (Tailscale Service `svc:ag`)

User-facing links never name a machine. `ag` is the Tailscale Service **`svc:ag`**
(`ag.tail44736d.ts.net`, VIP `100.115.69.33`, short name `ag` via MagicDNS), advertised by whichever
machine hosts sessions (today ag-engine, `ag-svc local`):

| URL | What |
|---|---|
| `http://ag:7373` | ag inbox (and the tickler webhook) |
| `http://ag:7374` | show / phone review / file inbox (`http://ag.tail44736d.ts.net:7374/r/<name>/` for the phone) |
| `http://ag:7375` | private chat |
| `http://ag:7376/<pi session id>` | AG Dash deep links |
| `https://ag.tail44736d.ts.net:7377` | AG Dash over HTTPS (voice needs it) |

Defined in `tailscale/policy.hujson` (autoApprover: `tag:ag-engine`) and via the API
(`ts-api PUT tailnet/-/vip-services/svc:ag`, ports 7373–7377); `ag-svc local` / `ag-svc status`. The iOS Shortcuts
still post to ag-mac's IP `100.107.192.32` (docs in `ios-shortcuts/`), so `ag-legacy-forward` on ag-mac forwards
those ports to `ag`; remove it once they point at `ag.tail44736d.ts.net`.

## Where services run

Every Ag service runs on the session host as a systemd user unit: `ag-mux` (agd), `ag-board` (AG Dash),
`ag-inbox`, `file-inbox`, `ag-private`, `tickler`, `presence`, `pi-hibernate` (memory pressure from
`/proc/pressure/memory`), `ag-nav`, `mcp-gateway`, `pi-sessions-sync`, `nessie`, `ag-telegram`. ag-mac keeps only
the extremity role: computer use, Mac-only apps and CLIs, plus `mem-watch`, `headless-display`,
`chrome-tab-reaper`, `tfy-env` and the Nessie app as LaunchAgents.

## History

Until 2026-09-29 sessions ran on ag-mac under a different terminal multiplexer. On 2026-09-29 they moved to
ag-engine under tmux + agd in one cut-over: checkouts rsynced (uncommitted work, stashes and `.env` files
included), Pi session files and service state copied, the old layout exported and restored with Pi asleep, roles
flipped in `machines/README.md`, and `ag-svc local`. Verified with sha256 per file: 3,202 Pi session files, 173
service-state files and 1,335 `~/inbox`/`~/review` files identical; all 163 tabs back with the same workspace,
label and session file. Paths from ag-mac keep working on the engine: `/Users/natkoersch` is a symlink to
`/home/nathan` (`bootstrap-linux`).
