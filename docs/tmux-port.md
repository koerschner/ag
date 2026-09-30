# Porting Ag from Herdr to tmux

Status (2026-09-29): **done.** Built and cut over the same day: ag-engine hosts every session (ag-mux on
tmux) and every Ag service, ag-mac is the extremity, and links use the Tailscale Service `ag`. The one-off
migration scripts were deleted after the move; "The move" at the end records what was done and verified.

## Summary

Yes, we can do it, and the shape is simple: **tmux does the terminals, a small Ag daemon (`agd`)
does everything Herdr adds on top, and a `herdr`-compatible CLI (`ag-mux`, also installed as
`herdr`) keeps every existing script working.**

The reason it's tractable: almost nothing in Ag depends on Herdr's hard parts. Agent state doesn't
come from screen scraping; Pi, Claude, and Codex already *push* it through small hooks
(`pane.report_agent`, `pane.report_agent_session`) over Herdr's JSON-lines socket. If `agd` speaks
that same socket protocol for the ~30 methods Ag uses, the hooks, `pi-hibernate`, `herdr-nav`,
`herdr-find`, and the plugins' logic run unchanged, and ag-board keeps polling a snapshot of the
same shape.

Recommended timing: **during the engine move.** Build and prove `ag-mux` on ag-engine (which has no
sessions yet) while arcade dev moves there (docs/ag.md step 5). Then step 6 moves sessions straight
from Herdr on ag-mac to tmux on ag-engine: one migration, not two. Herdr stays on ag-mac as a
fallback until the engine has run a week without it.

Honest caveat up front: Herdr already runs on Linux (it's installed on ag-engine), so the port is a
choice, not a requirement of the move. What we buy is ubiquity, plain SSH/mosh attach, a layer we
own, and no upstream churn (protocol 22 and counting). What we pay is roughly 2k lines of our own
code and three real losses (the live sidebar, inline images, and Moshi's Cmd-key forwarding), each
with a mitigation below.

## 1. What Ag uses from Herdr today

From Herdr 0.9.1's source (Rust, ~270k lines, Apache-2.0, github.com/herdrdev/herdr), its skill
and API schema, and a grep of every `herdr` call in `~/ag` and `~/dotfiles-seen-setup`.
Live scale today: 14 workspaces, 158 tabs, 161 panes, 96 Pi agents (65 panes are hibernated shells).

### Model and IDs
- Workspace → tab → pane, IDs `w2K`, `w2K:t5G`, `w2K:pE`: stable, never reused, **persisted across
  server restarts**. A pane moved to another workspace gets a new ID (the old one only resolves for
  the moved process), which is why `HERDR_TAB_ID`/`HERDR_WORKSPACE_ID` go stale after auto-filing.
- Labels on workspaces and tabs (the tab-bubbles plugin appends `●`, so half the scripts strip
  `\s*●$`). `--no-focus` / `--focus` on every create.
- Env injected per pane: `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`,
  `HERDR_PANE_ID`.

### Commands Ag calls (CLI and socket)
| Area | Used | Callers |
|---|---|---|
| workspace | `list`, `get`, `create --label --cwd --no-focus`, `move` (socket, pin Inbox first) | ag-inbox, tickler, herdr-inbox-file, herdr-new-pi-tab, pin-inbox |
| tab | `list [--workspace]`, `get`, `create --workspace --cwd --label --[no-]focus`, `rename`, `focus`, `close` | ag-board, ag-inbox, tickler, file-inbox, herdr-find, herdr-tab-name, bubbles |
| pane | `list`, `get`, `current`, `neighbor`, `layout`, `split`, `run`, `send-text`/`send_input`, `send-keys`, `read --source visible\|recent\|recent-unwrapped --lines`, `wait-output`, `process-info`, `move --new-tab --workspace --label` | herdr-inbox-file (move), pi-hibernate, herdr-find, herdr-focus-agent, herdr-nav, agent rules |
| agent | `list`, `get`, `start <name> --kind pi --pane --timeout -- args`, `prompt [--wait]`, `wait --until`, `read`, `send-keys` | ag-board, ag-inbox, tickler, file-inbox, client-cua-gate, agents themselves |
| agent reports | `pane.report_agent` (state), `pane.report_agent_session` (session file) | pi/claude/codex integrations |
| api | `api snapshot` / `session.snapshot` (ag-board every 1.5 s, herdr-link, herdr-focus-agent, pi-hibernate), `events.subscribe` (pane/tab/workspace focus, closed, agent_status_changed) | ag-board, herdr-nav, pi-hibernate |
| misc | `notification show --body --sound`, `layout.export` (herdr-nav reopen), `agent.view.set` (recent-agents), `server reload-config`, `plugin link`, `integration status` | tickler, mem-watch, ag-board, install |

Unused: worktree integration (our rules forbid it), `--machine`, kitty-graphics APIs, copy-mode APIs.

### Agent lifecycle
- States `idle`/`working`/`blocked`/`done`/`unknown`. `done` = finished and not yet **seen**
  (focus marks seen). Pi's `blocked` comes from a `herdr:blocked` Pi event.
- `agent start` waits until the agent reports ready; `agent prompt` uses bracketed paste + Enter;
  `--wait` requires observed `working` within 5 s (else `agent_prompt_stalled`), then waits for a
  settled state. Names `[a-z][a-z0-9_-]{0,31}` follow the pane occupant.
- Snapshot per agent: `agent`, `agent_status`, `agent_session.value` (the Pi session file, the
  key ag-board, herdr-link, tickler, and file-inbox use to find a session), `state_change_seq`, cwd.

### Persistence and resume
`~/.config/herdr/session.json` (97 KB) holds the layout; on server start Herdr restores
workspaces/tabs/panes and **resumes each agent** from its reported session (`pi --session <file>`).

### Client side
- `ag` on ag-client = `herdr --remote ag --remote-keybindings server` (runs host-side
  `[[keys.command]]` bindings; `presence` detects the `herdr remote-client-bridge` process).
- Window title `herdr: {workspace}`: Hammerspoon's `focusedWindowIsHerdr()` gates Cmd→`Ctrl+B`
  chord forwarding (spec `herdr/dot-config/herdr/shortcuts.json`) and image paste (upload, then
  paste the remote path).
- Host bindings: Cmd+T new Pi tab, Cmd+Shift+T reopen closed pane, Cmd+[/] focus history,
  prefix+f find tab (popup), prefix+L last space, Cmd+D/Shift+D split, Cmd+W close, Cmd+1–9.
- `herdr-focus-agent` (Hammerspoon asks over SSH whether Escape would interrupt an agent).
- `herdr-link --gemini` → HerdrLink.app → `hammerspoon://herdr?tab=` → `herdr tab focus`.
- Toasts delivered as terminal notifications to Ghostty.

### UI
The sidebar: workspaces (Inbox pinned first), tabs with agent badges, an Agents list sorted by most
recent state change, `●` bubbles for unseen results. Popups for `herdr-find`.

### Phone
Moshi attaches to Herdr natively (it detects Herdr and tmux, lists sessions, swipes between tabs,
forwards most Cmd keys). The board's 📱 button goes through `file-inbox` to
`moshi://herdr?workspace=&tab=&pane=`.

## 2. The design

```text
 ag-client (Ghostty + Hammerspoon)      ag-phone (Moshi, mosh/ssh)
        │ ssh -t ag-engine ag-mux attach        │ tmux picker / moshi://tmux
        ▼                                       ▼
 ┌──────────────────────── ag-engine ─────────────────────────┐
 │ tmux server  (tmux -L ag; config ag/tmux/ag.tmux.conf)     │
 │   session = workspace, window = tab, pane = pane           │
 │   user options: @ag_id @ag_label @ag_agent @ag_status ...   │
 │        ▲ control-mode client (events)                      │
 │ agd  (Bun, systemd user unit)                               │
 │   · Herdr-compatible JSON-lines socket ($HERDR_SOCKET_PATH) │
 │   · ID registry, agent state machine, seen/done tracking   │
 │   · snapshot cache, events.subscribe, layout persistence   │
 │ ag-mux CLI (also on PATH as `herdr`) → agd socket          │
 │ ag-board · ag-inbox · tickler · pi-hibernate · herdr-nav    │
 └─────────────────────────────────────────────────────────────┘
```

### 2.1 tmux as the runtime
- One dedicated server, `tmux -L ag` (its own socket, so a stray `tmux` elsewhere doesn't mix in).
- **Workspace = tmux session, tab = window, pane = pane.** Session name = label (sanitized; tmux
  forbids `:` and `.`); the real label lives in `@ag_label`. Identity lives in `@ag_id`, never the
  name, so renames are free.
- Env: `new-window -e` / `split-window -e` set `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`,
  `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID` (keeping the `HERDR_*` names is what makes the integrations
  work unchanged; `AG_MUX=1` is set too for new code).
- Config `ag/tmux/ag.tmux.conf`: prefix `C-b` (so every Hammerspoon chord and Moshi's defaults work
  as-is), `extended-keys on`, `allow-passthrough on`, `set-titles-string "herdr: #{@ag_label}"`
  (keeps Hammerspoon's title check working until it's renamed), mouse, large `history-limit`,
  `focus-events on`, `remain-on-exit off`.

### 2.2 IDs
- `agd` mints Herdr-format IDs (`w<n>`, `w<n>:t<n>`, `w<n>:p<n>`, base-36, never reused; counters
  persisted) and stores them in `@ag_id` on the session/window/pane, plus a map to tmux's own
  `$`/`@`/`%` IDs (which are stable too, but reset when the tmux server restarts).
- **Better than Herdr:** a pane keeps its ID when its tab moves to another workspace
  (`move-window` keeps the process and `%id`). `HERDR_PANE_ID` is always valid; the old ID's
  workspace prefix just becomes historical. `HERDR_TAB_ID` also stays valid (tab = window moves
  whole); only `HERDR_WORKSPACE_ID` goes stale, and `pane get` resolves it live, as today.

### 2.3 agd: the Herdr-compatible socket
Bun/TypeScript like ag-board and ag-inbox, one file per area, compiled with `bun build --compile`.
It implements exactly the methods in section 1 with Herdr's request/response and error shapes
(`{"id","result"}` / `{"id","error":{"code","message"}}`), so direct socket clients
(pi-hibernate, herdr-nav, herdr-find, pin-inbox, hooks) need no change.

How each maps:

| Herdr | tmux / agd |
|---|---|
| `workspace create/rename/close/move` | `new-session -d`, `rename-session` + `@ag_label`, `kill-session`, `@ag_order` (Inbox pinned by ordering rule) |
| `tab create/rename/focus/close` | `new-window -d [-c cwd]`, `rename-window` + `@ag_label`, `switch-client`+`select-window`, `kill-window` |
| `pane split/close/neighbor/layout` | `split-window -d -h/-v`, `kill-pane`, `select-pane -U/-D/-L/-R` dry-run via geometry from `list-panes -F`, `window_layout` |
| `pane move --new-tab --workspace` | `move-window -s @w -t <session>:` for single-pane tabs (the auto-filer's case), `break-pane` + `move-window` otherwise |
| `pane run` / `send-text` / `send_input` | `load-buffer -` + `paste-buffer -p -d` (honors the app's bracketed-paste mode), then `send-keys Enter` |
| `pane send-keys` | logical keys → tmux names (`ctrl+c`→`C-c`, `esc`→`Escape`, `enter`→`Enter`, arrows), validated before sending |
| `pane read visible/recent/recent-unwrapped`, `--format ansi` | `capture-pane -p` / `-S -N` / `-J -S -N` / `-e` |
| `pane wait-output --match/--regex` | poll `capture-pane` every 200 ms (same "already-present output matches" semantics) |
| `pane process-info` | `pane_pid` + `ps -o pid,ppid,pgid,tpgid,comm,args` tree; foreground = processes in the tty's `tpgid` |
| `agent start` | require the pane at a shell prompt (`pane_current_command` is the shell, no children), `send-keys` the command, wait for the agent's first report (`ready`), `agent_not_ready` on timeout |
| `agent prompt [--wait]`, `agent wait --until` | paste + Enter; wait on agd's state machine (same 5 s `working` gate, `agent_prompt_stalled`, `timeout`) |
| `report_agent`, `report_agent_session` | update state + `@ag_agent`, `@ag_status`, `@ag_session` on the pane; bump `state_change_seq`; emit `pane.agent_status_changed` |
| `done` vs `idle` (seen) | `idle` report → `done` unless the pane is the current pane of an attached client; any focus change onto it marks seen → `idle` |
| `session.snapshot` | in-memory model refreshed from one `list-panes -a -F …` per event burst (and every 5 s as a safety net), same JSON shape |
| `events.subscribe` | tmux control-mode notifications (`%window-add`, `%window-close`, `%window-renamed`, `%session-window-changed`, `%client-session-changed`, `%pane-mode-changed`) plus agd's own agent events, fanned out as Herdr event names |
| `notification show` | `display-message -d 4000` on every client, plus an OSC 9 passthrough to each client's terminal so Ghostty raises a macOS notification; `--sound` maps to the bell |
| `layout.export` | `window_layout` string + per-pane cwd/session (enough for herdr-nav's reopen) |
| `server reload-config` | `source-file ~/.config/ag/ag.tmux.conf` |
| `agent.view.set`, `plugin link`, `integration status` | no-ops that return `ok` (their behavior is built in, below) |

Events come from a single control-mode client (`tmux -L ag -C attach -t _agd`) on a hidden
`_agd` session with `refresh-client -f no-output,ignore-size`, so it never resizes windows or
counts as "looking at" anything. If control mode drops, agd reconnects and rebuilds from
`list-*`.

### 2.4 The ag-mux CLI
- `ag-mux <group> <cmd> …` with Herdr's CLI grammar (the flags in section 1), JSON on stdout,
  errors as JSON on stderr, exit 1/2 as Herdr does. Installed as `ag-mux` and, on hosts without real
  Herdr, symlinked as `~/.local/bin/herdr`, so every caller (including the hardcoded
  `~/.local/bin/herdr` paths in ag-board and friends) works untouched.
- It's a thin client to agd's socket (Pi extensions call `herdr pane get` synchronously on every
  prompt, so startup must stay in the tens of ms).
- Bare `ag-mux` / `ag-mux attach [workspace]` = `tmux -L ag attach` (creating Inbox if the server is
  empty). `ag-mux --skill` prints a short skill so the agent rules can point at it.

### 2.5 What the Herdr plugins become
- **pin-inbox**: agd's ordering rule (Inbox first, then `@ag_order`), used by the status line and
  the switcher.
- **tab-bubbles**: a window option `@ag_unseen` that the status line renders as `●`. **Labels stop
  being mutated**, so the `\s*●$` stripping in five scripts becomes dead code (harmless; clean up
  later).
- **recent-agents**: the switcher's sort order.

### 2.6 The sidebar replacement
tmux can't draw a persistent side panel without faking one as a pane in every window (the
tmux-sidebar approach: fragile, and it breaks `pane_count`-based logic like the auto-filer's
"single-pane tab" check). So:
1. **Two-line status bar.** Line 1: workspaces, Inbox first, each with a count of tabs needing you.
   Line 2: tabs in the current workspace with state glyphs (working ⠿, blocked ⚠, unseen ●).
   Rendered from `@ag_*` options with tmux formats, so no process runs per redraw.
2. **Switcher popup** (`prefix+s` and `prefix+w`, Cmd+O via Hammerspoon): an fzf list of every tab
   grouped by workspace with status and "last change" age, sorted recent-first (today's Agents
   list), Enter jumps. `herdr-find` stays on `prefix+f`.
3. **AG Dash** stays the real overview, as it already is on the phone.

### 2.7 Persistence and restore (our own session.json)
agd writes `~/.local/state/agd/layout.json` on every structural change (debounced): workspaces with
labels/order, tabs with labels, each window's `window_layout`, and per pane its cwd, agent kind, and
session file. `ag-mux restore [--from file]` rebuilds it:
creates sessions/windows, applies layouts, and for agent panes starts **the hibernation sleep
screen** (`pi-hibernate wait <file> && pi --session <file>`) rather than 96 Pis at once; focusing a
tab wakes it, as hibernation does today. This one mechanism covers tmux server restarts, reboots,
a rebuilt engine (docs/ag.md "Herdr layout … snapshotted and restored"), and the Herdr→tmux import.

### 2.8 Client, keys, links
- **`ag` on ag-client** → `ssh -t ag-engine ag-mux attach` (ag-mac's SSH alias today). Host-side
  bindings live in tmux, so there's no `--remote-keybindings` concept to get wrong.
- **Key bindings** (`ag.tmux.conf`, generated from `shortcuts.json` so `herdr-shortcuts-check` keeps
  working): `prefix+t` `run-shell -b herdr-new-pi-tab`, `prefix+u` reopen, `prefix+[`/`]` history
  (tmux's own `[` copy-mode moves to `prefix+Escape`), `prefix+f` `display-popup -E herdr-find`,
  `prefix+L` `switch-client -l`, `prefix+v`/`-` splits, `prefix+x` close, `prefix+1..9`.
- **Hammerspoon**: unchanged if the title prefix stays `herdr:`; rename to `ag:` in a follow-up.
  Image paste keeps working (it uploads, then pastes a path).
- **presence**: detect `ssh … ag-mux attach` / `tmux … attach` instead of the Herdr bridge process;
  tmux's `list-clients -F '#{client_tty} #{client_activity} #{client_termname}'` also says who's
  attached, from where, and when they last typed.
- **Focus** (`tab focus`, herdr-link, HerdrLink, ag-board "Open in Herdr"): tmux focus is per client.
  `ag-mux tab focus` switches the most recently active client, or the one named by `--client` /
  `AG_CLIENT` (`mac`, `phone`, mapped from tty/Tailscale IP by presence). Two clients in the same
  workspace share its current tab, which matches Herdr's single global focus today.
- **Links**: tmux 3.4 passes OSC 8 hyperlinks through, so `herdr-link` can print real clickable
  links in Ghostty instead of relying on bare-URL detection. The `gemini://` HerdrLink path keeps
  working meanwhile (`tab focus` is compatible).
- **Moshi**: tmux is a first-class Moshi multiplexer (session picker, window swipes, shortcut
  panel, mosh reattach). The board's 📱 button becomes: agd selects the pane's window for the phone's
  client, then 302s to `moshi://tmux?session=<workspace>` (Moshi's link only focuses windows 0–9,
  so we select server-side). mosh-server needs installing on the engine (`bootstrap-linux`).

### 2.9 What changes for agents
`agents.md/includes/herdr.md` becomes an ag-mux note: same commands, "don't run bare
`herdr`/`tmux attach` from inside a pane", `tmux -L ag` for anything the shim doesn't cover. The
`herdr --skill` references point at `ag-mux --skill`.

## 3. Scorecard

**Maps cleanly** (thin code): the whole topology, labels, IDs, `--no-focus`, pane I/O and reads,
key sending, splits, moves, process info, reload, keybindings, remote attach, titles, the
integration hooks (unchanged), and the scripts (unchanged).

**Needs new code** (~2k lines TS plus tests): agd's socket server and state machine (seen/done,
`--wait` semantics, names), snapshot/event fan-out from control mode, layout persistence and
restore, the status bar formats and switcher, notifications, client-aware focus, the Moshi hop, and
a **compat test suite** that runs one scenario (create workspace/tab, start Pi, prompt `--wait`,
read, move, snapshot, close) against real Herdr on ag-mac and ag-mux on ag-engine and diffs the
JSON shapes.

**Gets worse**
- No always-visible sidebar with the live Agents list. Mitigation: two-line status, switcher popup,
  AG Dash.
- No inline kitty-graphics images in panes (tmux doesn't support the protocol; Herdr does). Pi falls
  back to text; images still show in AG Dash's transcript.
- Moshi's direct Cmd-key forwarding (Cmd+T, Cmd+D, …) was a Herdr feature; with tmux Moshi sends
  prefix chords from its shortcut panel. Needs a check on the phone; worst case `Ctrl+B` + key
  there, as for Cmd+W today.
- We own the maintenance, including edge cases Herdr already solved (agent-ready detection timing,
  bracketed paste quirks).
- Restore resumes agents lazily (sleep screens) rather than immediately. That's arguably better for
  memory, but it's a behavior change.

**Gets better**
- tmux is on every Linux box and in every terminal app; attach from anywhere over plain SSH or mosh
  (Moshi, Blink, a borrowed laptop), with no Herdr client, version match, or bridge.
- Mature and stable: no protocol bumps, no "never run `herdr update`" rule.
- Stable pane and tab IDs across auto-filing; labels no longer carry `●`.
- One restore mechanism for restarts, reboots, rebuilt engines, and migration.
- Real OSC 8 links; tmux formats and control mode make new views cheap.
- Workers (docs/ag.md) can run the same tmux + agd, so a session looks the same wherever it runs.

## 4. Sequencing

Relative to docs/ag.md's plan (step 5 arcade dev on the engine, step 6 move session hosting):

1. **Build on ag-engine now** (in parallel with step 5): agd, ag-mux, `ag.tmux.conf`, systemd user
   unit, `bootstrap-linux` installs tmux config + mosh. Real Herdr stays uninstalled from the
   engine's PATH so `herdr` = the shim there.
2. **Compat suite green** against real Herdr (ag-mac) and ag-mux (engine).
3. **Run the stack on the engine** against ag-mux: ag-board, ag-inbox, tickler, pi-hibernate
   (Linux memory-pressure check instead of `sysctl`), herdr-nav, presence. Nathan dogfoods a few new
   sessions via `ssh -t ag-engine ag-mux attach` and Moshi.
4. **Cutover (= docs/ag.md step 6):** export Herdr's snapshot on ag-mac, copy Pi session files (the
   pi-sessions archive already has them), `ag-mux restore --from herdr-snapshot.json --path-map
   /Users/natkoersch=/home/nathan`, point `ag` and the inbox/board URLs at the engine.
5. **After a quiet week:** remove Herdr from ag-mac, rename the `herdr` pieces (`herdr/` →
   `tmux/`, `herdr-*` helpers → `ag-*`, `HERDR_*` → `AG_*` with the old names still exported), and
   update AGENTS.md and the README.

Why not before the move: porting ag-mac's live Herdr to tmux first means migrating 158 tabs twice.
Why not after: we'd build restore/import for Herdr-on-engine and then again for tmux; and the engine
is the one place with no live sessions to disturb right now.

## 5. Decisions (Nathan, 2026-09-29)
1. Go ahead, built on the engine during the move: **yes** ("port should go ahead"; then "run it").
2. Losing Herdr's always-on sidebar (two-line status bar + switcher + AG Dash instead): **fine**.
3. Restored sessions come back hibernated and wake when their tab is opened: **yes**.
4. Links use a machine-independent address, never ag-mac: the Tailscale Service `ag`.
5. Every Ag service moves to ag-engine; ag-mac keeps only the extremity role.

## Build status (2026-09-29)

Built and on `main`, running:

- **`ag-mux`** (`bin/dot-local/bin/ag-mux`, a sh launcher; implementation in
  `bin/dot-local/lib/ag-mux/ag-mux.ts`): agd plus the Herdr-compatible CLI (the ~45 socket methods and CLI
  commands Ag uses), layout save/restore with sleeping Pi panes, crash recovery (agd restarts a dead tmux
  server and restores the layout), status bar, switcher. On a host that still runs Herdr,
  the launcher execs `herdr` directly, so the mac is unchanged until cutover.
- **Callers switched to `ag-mux`**: ag-board, ag-inbox, tickler, file-inbox, herdr-new-pi-tab,
  herdr-focus-agent, herdr-link, mem-watch, client-cua-gate, the Pi extensions (herdr-context,
  herdr-inbox-file, herdr-tab-name, tickler, ag-notify), Hammerspoon's focus links, and the agent
  instructions (`agents.md/includes/herdr.md`). Direct socket clients (pi-hibernate, herdr-nav,
  herdr-find) find agd's or Herdr's socket automatically.
- **tmux config** `tmux/dot-config/ag/ag.tmux.conf` (sources `~/.tmux.conf` first), **`ag-mux-shell`**
  (gives panes made with plain tmux keys their IDs).
- **ag-engine**: `ag-mux.service` (systemd user unit, `KillMode=process` so restarting agd never kills
  sessions) is enabled and running with an Inbox; real Herdr removed; mosh installed.
  `bootstrap-linux` stows `tmux` and enables the unit.
- **Tests**: `tests/ag-mux-smoke.sh` (23 checks: topology, pane I/O, moves, events, shapes against Herdr
  fixtures in `tests/fixtures`, restore, crash recovery; `AG_MUX_TEST_PI=1` adds a live Pi start/prompt).
  Green on ag-mac (tmux 3.7) and ag-engine (tmux 3.4).
- Found on the way: tmux 3.7 crashes on `break-pane` with no client attached, so ag-mux moves panes with
  a placeholder window and `swap-pane`. Pi on the engine spends its first ~60 s retrying Slack/TapKit MCP
  OAuth (no browser there), and ignores prompts until it's done; that's the engine's MCP auth, not ag-mux.

## The `ag` address (Tailscale Service `svc:ag`)

User-facing links never name a machine. `ag` is the Tailscale Service **`svc:ag`**
(`ag.tail44736d.ts.net`, VIP `100.115.69.33`, short name `ag` via MagicDNS), advertised by whichever
machine hosts sessions:

| URL | What |
|---|---|
| `http://ag:7373` | ag inbox (and the tickler webhook) |
| `http://ag:7374` | show / phone review / file inbox (`http://ag.tail44736d.ts.net:7374/r/<name>/` for the phone) |
| `http://ag:7375` | private chat |
| `http://ag:7376/<pi session id>` | AG Dash deep links |
| `https://ag.tail44736d.ts.net:7377` | AG Dash over HTTPS (voice needs it) |

- Defined in `tailscale/policy.hujson` (autoApprover: `tag:ag-engine`) and via the API
  (`ts-api PUT tailnet/-/vip-services/svc:ag`, ports 7373–7377). Hosts must be tagged, so ag-engine hosts
  it; `ag-svc local` / `ag-svc status`.
- ag-engine serves it with `ag-svc local`.
- Switched to it: herdr-link, session-link, show's phone links, AG Dash (HTTPS URL, copy-link, 🔥 texts,
  file-inbox URL), tickler and ag-inbox texts, Hammerspoon's inbox capture, client-cua-gate, the skills,
  and `agents.md`. The dotfiles `/etc/hosts` `ag` → ag-mac alias is gone.
- Not yet: README.md (Nathan is editing it) and the iOS Shortcuts, which still post to ag-mac's IP
  `100.107.192.32` (docs in `ios-shortcuts/`); they switch to `ag.tail44736d.ts.net` at cutover.

## Where every service goes

ag-mac keeps only the extremity role: computer use, Mac-only apps and CLIs. Everything else moves to
ag-engine as a systemd user unit.

| ag-mac LaunchAgent | Fate | Notes for the move |
|---|---|---|
| `ag-board` (AG Dash, 7376/7377) | **Move** | Listen on 127.0.0.1 (svc:ag fronts it); drop its own `tailscale serve --https` (svc:ag does TLS); `/usr/local/bin/tailscale` path; Linux `open`-free. |
| `ag-inbox` (7373) | **Move** | Needs Jev/LLM keys on the engine (op-ag); tab creation already goes through ag-mux. |
| `file-inbox` (7374: show, phone review, Send to ag) | **Move** | Moshi deep link becomes `moshi://tmux?session=<workspace>` after agd selects the pane for the phone's client. |
| `ag-private` (7375) | **Move** | OpenRouter key on the engine. |
| `tickler` | **Move** | Items and logs to the engine's persistent volume. |
| `presence` | **Move** | Polls ag-client over SSH from the engine (needs an engine → client SSH key, like `mac`'s); detects `ag-mux attach` instead of the Herdr bridge. |
| `pi-hibernate` | **Move** | Memory pressure from `/proc/pressure/memory` instead of `sysctl`. |
| `herdr-nav` (back/forward, reopen) | **Move** | Works against agd's events already; rename to `ag-nav` later. |
| `mcp-gateway` | **Move** | The engine runs the gateway; `mcp-tunnel` retires; ag-mac points at the engine only if it still needs MCP. |
| `pi-sessions-sync` | **Move** | The engine's timer already runs; retire the Mac copy once no sessions live there (it also pulls ag-client). |
| `moshi-hook` | **Move** | Runs where the agents run; re-pair Moshi with ag-engine (needs Nathan's phone once). |
| `mem-watch` | **Keep + add** | Keep on ag-mac (CUA memory), add a Linux version on the engine. |
| `nessie` (agent-trace sync app) | **Keep, open question** | Mac app; sessions on the engine need a Linux way to sync traces. |
| `headless-display` | **Keep** | Computer use on a closed MacBook. |
| `chrome-tab-reaper` | **Keep** | Chrome is used for CUA. |
| `tfy-env` | **Keep** | TrueFoundry key for Mac GUI apps (ChatGPT/Codex desktop). |
| Herdr itself | **Retire** | After a quiet week on the engine; then drop the `herdr/` package, HerdrLink.app, and the Herdr plugins. |

Activity capture (`activity-log.ts`, `ag.jsonl`) moves with the sessions, since it runs inside Pi.

## The move (2026-09-29)

Done by one-off scripts, deleted afterwards (in git history before commit "Remove cutover scripts"):
checkouts rsynced to the engine (99, uncommitted work, stashes and `.env` files included, worktrees
repaired, dependencies reinstalled), Pi session files and service state copied, every Pi on ag-mac
stopped, Herdr's layout exported and restored on the engine with Pi asleep, roles flipped in
`machines/README.md`, and `ag-svc local`.

Verified with sha256 per file: 3,202 Pi session files, 173 service-state files and 1,335 `~/inbox`/`~/review`
files identical; all 163 tabs back with the same workspace, label and session file; random woken tabs
resumed their own conversation; the pi-sessions archive runs from the engine. Two sessions Nathan started
on ag-mac during the move, and the prompt/tab-name log lines they wrote, were copied over afterwards.

Paths from ag-mac keep working on the engine: `/Users/natkoersch` is a symlink to `/home/nathan`
(`bootstrap-linux`). `ag-infra down` still refuses while the engine has unsaved git work (`ag-unsaved`).

Left over: `ag-legacy-forward` on ag-mac forwards its old ports to `ag` because the iOS Shortcuts still post
to ag-mac's IP (`ios-shortcuts/`); remove it once they point at `ag.tail44736d.ts.net`. Herdr on ag-mac is an
idle fallback; retiring it (and the `herdr/` package, HerdrLink.app, and ag-mux's Herdr pass-through) is the
last step.
