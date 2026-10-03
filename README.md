# ag

> **Setting up your own Ag?** Follow [docs/onboarding.md](docs/onboarding.md). Fastest: hand it to the ChatGPT desktop app with computer use turned on, and step in only for payments and 2FA.

"always going" or "automatic gun", depending on how edgy you're feeling

Ag is an agent system: dozens of long-lived coding-agent sessions (Pi) running on an always-on Linux
machine, organized like a to-do list, reachable from a laptop, a phone or a browser, and able to reach into
a Mac when a task needs macOS. You run and set up all of it through one
command, **`ag`**.

This repo is the whole system as code: the `ag` CLI and its services, the session layer, the global agent
instructions, the skills, and the infrastructure to build the machines. Any machine can be rebuilt from it.

- New here? Read **[How Ag works](#how-ag-works)**, then **[docs/onboarding.md](docs/onboarding.md)** to build your own.
- Every command: **[The `ag` CLI](#the-ag-cli)** (or `ag help`, and `ag <verb> --help`).
- Internals of one component (AG Dash, the inbox, the tickler, …): **[docs/reference.md](docs/reference.md)**.

## How Ag works

**Sessions are the unit of work.** Each task is one Pi agent session in its own tab. Tabs live in
**workspaces**, one per topic (Economy, Social, …), and new work lands in the **Inbox** workspace, then files
itself into the right topic after the first reply. An open tab is an open item; closing it means it's done.
That makes the session layer a GTD system: things you're waiting on sit in **Waiting for** with a wake-up
scheduled, and anything deferred goes in the **tickler**, which reopens it later as a new session.

**The machines** (inventory and roles: [`machines/README.md`](machines/README.md)):

| Role | Today | What runs there |
|---|---|---|
| **host** (the engine) | `ag-engine`, a rented Hetzner Linux VM | every session (tmux, driven by `ag-mux`), every Ag service, the repos and worktrees |
| **extremity** | `ag-mac`, an always-on MacBook | only what needs macOS: computer use, Mac-only apps and CLIs, Keychain. Agents reach it with `mac run …` / `mac cua "…"` |
| **client** | `ag-client` (the Mac Nathan sits at), `ag-phone` | no sessions or services; it attaches to the host (`ag`), captures to the inbox (Hammerspoon), and shows what agents open for you |

Everything is joined by one Tailscale tailnet, and every service is addressed by the machine-independent name
`ag` (a Tailscale Service), so moving the host changes no links.

**Ways in:**

- **`ag`** in a terminal attaches to the host's sessions (like `tmux attach`, with the host's keybindings).
- **The ag inbox** (`http://ag:7373`) starts a new session from anywhere: `ag spawn "…"` from a shell,
  both Command keys on the Mac (with Shift: plus a screenshot), the Action Button on the phone, the share sheet. A capture that continues an
  open session is delivered into that session instead.
- **AG Dash** (`http://ag:7376`) is a Kanban board over every session: what needs you, what's working,
  what's waiting, with transcripts, a live terminal view and a prompt box. It works as an iPhone web app.

**Running by itself:** the tickler (deferred items and wake-ups), routines (recurring jobs), presence (is
Nathan at his Mac?), hibernation of idle sessions, a shared MCP gateway, and an archive of every transcript.
`ag status` shows them all.

## Set up a machine

You need macOS or Ubuntu 24.04, [Tailscale](https://tailscale.com) signed in to the tailnet, and access to
this repo (public: `https://github.com/koerschner/ag`).

```sh
git clone git@github.com:koerschner/ag.git ~/ag
~/ag/bin/dot-local/bin/ag setup            # Linux, if you're not Nathan: add --no-dotfiles
ag doctor                                  # what's still missing on this machine
```

`ag setup` is idempotent; re-run it whenever you like (`ag setup --pull` pulls first). It installs the agent
CLIs (Pi, Claude Code, Codex, Bun, …), links this repo's config into `~` with GNU Stow (backing up any file in
the way), builds the agent instructions, and starts the services for this machine's role (systemd user units on
Linux, LaunchAgents on macOS). It finishes with a checklist of what it can't do for you.

**Secrets never go in git.** `ag doctor` lists the ones this machine still needs; typically:

- Pi model logins: run `pi`, then `/login`.
- GitHub CLI: `gh auth login`.
- `TFY_TOKEN` in `~/.zshenv.local` (mode 0600) to route models through the TrueFoundry gateway. Optional:
  without it each tool uses its own login.
- On the host and ag-mac: 1Password service-account tokens for `op-ag` / `op-work` / `op-shared`, which
  agents use to read credentials on demand. Full list and recovery copies:
  [docs/reference.md → Secrets](docs/reference.md#secrets-move-by-hand-never-commit).

Then check the running system with `ag status`, and attach with `ag`.

A **new host** is built from nothing with `ag infra up` (OpenTofu on Hetzner; cloud-init joins the tailnet and
runs `bootstrap-linux`, the script behind `ag setup`). See [`infra/README.md`](infra/README.md). A new machine also gets a row in
[`machines/README.md`](machines/README.md), which is what "every machine" means to `ag sync` and `ag status`.

On a Mac client, Hammerspoon provides the capture shortcut, image paste and session shortcuts: load
`~/.hammerspoon/ag.lua` from your `init.lua` with `pcall(require, "ag")` (Nathan's dotfiles do this).

## The `ag` CLI

`ag` with no arguments attaches to the host. `ag <verb>` runs a subcommand; `ag help` lists them all and
`ag <verb> --help` explains one.

- **Sessions as arguments.** Anywhere a verb takes a session `<s>`, you can pass a session id (or a unique
  prefix), a tab or pane id, an AG Dash link, or part of the tab's label. It's resolved fresh every call, so
  it survives tabs moving between workspaces. With no session, the verb acts on the session you're in.
- **Runs where it has to.** Session and system verbs run on the host; from any other machine `ag` forwards
  them over SSH. `ag setup` and `ag doctor` always run on the machine you call them on.
- **Machine-readable.** Most verbs take `--json`.

### Set up and maintain machines

| Command | What it does |
|---|---|
| `ag setup [--pull] [--no-dotfiles]` | install or update Ag on this machine (runs `install` on macOS, `bootstrap-linux` on Linux) |
| `ag doctor` | check this machine's checkout, links, tools, secrets and tailnet, without changing anything |
| `ag sync [ag\|dotfiles\|all]` | push the repo and apply it on every machine: pull, restow, re-run setup when install steps changed |
| `ag status` | is Ag healthy: machines reachable, services up, computer-use queue, host memory, presence |
| `ag logs <service> [-f]`, `ag restart <service>` | read or restart a service on whichever machine runs it |
| `ag unsaved` | git work under `~` that exists only on this machine |
| `ag host` | which machine is the session host |
| `ag infra plan\|up\|down\|scale N\|status\|ssh` | create, scale and destroy the rented Linux machines |
| `ag routine list\|show\|new\|apply\|run\|fire\|log` | recurring jobs (see [Routines](#routines)) |
| `ag access [allow]` | macOS permissions agents need on ag-mac; answer a pending permission prompt |
| `ag usage` | how much agents use `ag` versus hand-rolled equivalents |

### Find and read sessions

| Command | What it does |
|---|---|
| `ag me` | this session's workspace, tab, pane, session id and AG Dash link |
| `ag ls [workspace] [--pinned\|--waiting\|--needs-you]` | open sessions, grouped by workspace |
| `ag find <words>` | "the session where I was doing X": open, hibernated and closed sessions |
| `ag search <description>` | the same, fuzzy: an LLM matches a plain-words description (AG Dash: Cmd+K) |
| `ag read <s> [--user\|--assistant] [--last N]` | a session's transcript as text |
| `ag peek <s>` | a session's terminal screen right now |
| `ag link [s] [--phone]` | a session's AG Dash link |

### Act on sessions

| Command | What it does |
|---|---|
| `ag spawn "prompt"` (or `-f file`) | open a new Inbox session that reports back to this one when done |
| `ag report "msg"` | report back to the session that spawned this one |
| `ag send <s> "msg" [--interrupt]` | prompt another session (wakes it if hibernated) |
| `ag merge <A…> [--into B]` | absorb other sessions' context, then retire them |
| `ag close [s]`, `ag resume <s>` | close a tab (the transcript stays), reopen it later |
| `ag rename "label" [s]`, `ag file <workspace> [s]` | rename a tab, move it to a topic workspace |
| `ag pin [on\|off\|toggle] [s]` | pin on AG Dash: top priority, red siren and a desktop alert while it's stalled, a phone ping when it needs you |
| `ag wait [s]`, `ag unwait [s]` | put a session in Waiting for, or take it out |

### Talk to people and services

| Command | What it does |
|---|---|
| `ag inbox` | the inbox server (`ag spawn` is the usual way to use it) |
| `ag text "msg"` | a short message to Nathan's phone |
| `ag messages` | Nathan's iMessage/SMS: read, search, send (via ag-mac) |
| `ag discord` | read and post on the team's Discord as the ag bot |
| `ag board` | the AG Dash server |

`ag <verb>` also reaches any `ag-<verb>` tool on PATH. Tools that keep their own names: `mac` (run or do
computer use on ag-mac), `show` (open a file or page on your screen, plus a phone link), `shot` (pull your
latest screenshots), `tickler`, `presence`, `cua-queue`, `op-ag` / `op-work` / `op-shared`. They live in
[`bin/dot-local/bin/`](bin/dot-local/bin/).

## Everyday use

```sh
ag                                   # attach to the sessions
ag spawn "find out why the staging deploy is slow"
ag ls --needs-you                    # what's waiting on me
ag find "consent sankey"             # dig up an old session
ag read <s> --assistant --last 2     # what did it conclude
ag status; ag logs ag-inbox -f       # is everything up; follow one service
```

Inside a session, agents use the same commands (the global instructions tell them to), so whatever you can do
from a shell, an agent can do for you.

## Routines

A routine is a job that repeats on its own: a saved, self-contained prompt that runs as a fresh unattended
session, or a plain command, on a schedule. One file per routine in [`routines/`](routines/):

```sh
ag routine new standup-digest --schedule "weekdays 08:30" < prompt.md   # scaffold routines/standup-digest.md
ag routine apply                                                       # schedule it (systemd timer on the host)
ag routine run standup-digest                                          # run it now
ag routine log standup-digest
```

Every routine also shows on AG Dash → Routines. Details: [docs/reference.md → Routines](docs/reference.md#routines).

## Working on ag

**Everything is in git.** Any change to how a machine is set up goes into this repo in the same task: commit,
push to `main`, then `ag sync` to apply it on every machine. Hand edits outside the repo get lost on the next
rebuild. (Nathan's personal shell, editor and window-manager config live in his separate public
[dotfiles](https://github.com/koerschner/dotfiles) repo; ag doesn't need it.)

**Layout.** Directories named like `bin/dot-local/bin/` are Stow packages: `ag setup` links
`bin/dot-local/bin/ag` to `~/.local/bin/ag`, and so on.

| Path | What |
|---|---|
| `bin/dot-local/bin/` | the `ag` dispatcher and every tool (`ag-*`, `mac`, `show`, `tickler`, …) |
| `bin/dot-local/lib/ag/` | `ag` verbs, one executable each; shared session resolver `aglib.py` |
| `bin/dot-local/lib/ag-mux/` | the session layer: tmux plus agd, driven through the `ag-mux` CLI ([docs/ag-mux.md](docs/ag-mux.md)) |
| `ag-board/`, `ag-board-editor/` | AG Dash's page and its editor bundle |
| `ag-inbox/` | inbox playbooks (workflows for common kinds of captures) |
| `pi/` | Pi settings, extensions (tickler tool, tab naming, notifications, …) and the generated `AGENTS.md` |
| `agents.md/` | sources of the global agent instructions; `agents.md/build` generates `pi/dot-pi/agent/AGENTS.md` |
| `agents/` | skills, loaded by Pi, Claude Code and Codex from `~/.agents/skills` |
| `claude/`, `codex/` | Claude Code and Codex config (they share the same `AGENTS.md`) |
| `systemd-user/`, `macos-launchagents/` | services and timers (Linux host; Macs) |
| `routines/` | routine definitions |
| `infra/` | OpenTofu for the rented machines |
| `machines/` | the machine inventory |
| `hammerspoon/`, `tmux/`, `macos-apps/`, `ios-shortcuts/`, `tailscale/` | client glue, terminal config, helper apps, phone shortcuts, tailnet policy |
| `toolsum/` | rules that turn agent tool calls into one-line summaries on AG Dash |
| `docs/` | design notes and the component reference |
| `install`, `bootstrap-linux` | the setup scripts behind `ag setup` |

**Adding a verb.** Drop an executable at `bin/dot-local/lib/ag/<verb>` whose second line reads
`ag <verb> — what it does` (that's what `ag help` shows) and that answers `--help`. Python verbs import
`aglib.py` for session resolution and AG Dash calls. Verbs there run on the host; add the verb to the
local-verbs list in `bin/dot-local/bin/ag` if it must run on the caller's machine. Then teach agents about it
in `agents.md/` and run `agents.md/build` (a pre-commit hook rejects a stale build).

**Tests:** `tests/ag-mux-smoke.sh` exercises the session layer on an isolated tmux server.

**What's specific to Nathan's setup today.** Ag was built for one person, so some things are hard-wired:
the machine table in `machines/README.md`, the tailnet name, the 1Password vaults and Keychain item names
behind `op-*`, the TrueFoundry gateway, the arcade.school MCP servers, the Telegram bot behind `ag text`, and
iMessage on ag-mac. Expect to touch those when Ag runs for someone else.

## Docs

| Doc | What |
|---|---|
| [docs/onboarding.md](docs/onboarding.md) | build your own Ag from nothing: accounts, tailnet, VPS, ag-mac |
| [docs/reference.md](docs/reference.md) | every component in depth: AG Dash, inbox, tickler, presence, MCP gateway, secrets, permissions, the client bridge, … |
| [docs/ag.md](docs/ag.md) | design and roadmap: the engine, ag-mac, workers, persistence |
| [docs/ag-cli.md](docs/ag-cli.md) | why the CLI looks the way it does (audit of what agents did by hand) |
| [docs/ag-mux.md](docs/ag-mux.md) | the session layer: tmux + `ag-mux` (agd) |
| [machines/README.md](machines/README.md) | machine inventory and roles |
| [infra/README.md](infra/README.md) | building machines with OpenTofu |
| [tmux/SHORTCUTS.md](tmux/SHORTCUTS.md) | keyboard shortcuts on every device |
| [agents.md/includes/attribution.md](agents.md/includes/attribution.md) | how agents label what they write for other people |
| [friction.md](friction.md) | log of places Nathan had to step in, and how each was fixed |
