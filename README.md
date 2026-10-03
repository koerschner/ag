# ag

for those blessed with a high token budget

Ag is an agent system: dozens of long-lived coding-agent sessions (Pi) running on an always-on Linux
machine, organized like a to-do list, reachable from a laptop, a phone or a browser. You run all of it
through one command, **`ag`**. This repo is the whole system as code, so any machine can be rebuilt from it.

> **New here?** Read [How Ag works](#how-ag-works) below, then build your own with
> **[docs/onboarding.md](docs/onboarding.md)**. Fastest: hand that doc to the ChatGPT desktop app with
> computer use turned on, and step in only for payments and 2FA.

## How Ag works

**Sessions are the unit of work.** Each task is one Pi agent session in its own tab, all in one flat list. A
new session sits in the **Inbox** until you first reply to it. An open tab is an open item; closing it means
it's done. Things you're waiting on sit in
**Waiting for** with a wake-up scheduled, and anything deferred goes in the **ag-tickler**, which reopens it
later as a new session.

**The machines**, joined by one Tailscale tailnet (inventory: [`machines/README.md`](machines/README.md)):

| Role | Example | What runs there |
|---|---|---|
| **host** (the engine) | `ag-engine`, a rented Linux VPS | every session (tmux, driven by `ag-mux`), every Ag service, the repos |
| **client** | your laptop, your phone | nothing; it attaches to the host and shows what agents open for you |
| **extremity** (optional) | `ag-mac`, an always-on Mac | only what needs macOS: computer use, Mac-only apps. Agents reach it with `ag-mac run …` / `ag-mac cua "…"` |

**Ways in:**

- **`ag`** in a terminal attaches to the host's sessions (like `tmux attach`).
- **ag-dash** (`http://ag:7376`): a Kanban board over every session (needs you, working, waiting) with
  transcripts and a prompt box. Works as an iPhone web app.

`ag` in those URLs is a Tailscale Service the host advertises, so links never name a machine.

## Everyday use

```sh
ag                                   # attach to the sessions
ag spawn "find out why the staging deploy is slow"
ag ls --needs-you                    # what's waiting on me
ag find "consent sankey"             # dig up an old session
ag read <s> --assistant --last 2     # what did it conclude
ag status                            # is everything up
```

Agents use the same commands inside their sessions, so whatever you can do from a shell, an agent can do
for you.

## Your rules: `~/.ag/ag-rules`

Ag's behavior on top of the basics is made of **ag-rules**: each is a rule in plain English plus the code it
boils down to, one folder per rule (`rule.md` + `rule.ts` / `keys.json` / `rule.lua`). Your own go in
**`~/.ag/ag-rules/<name>/`** (keep that folder in your dotfiles; this repo's author keeps theirs in the stow package
`dotfiles/ag/dot-ag/ag-rules`). Keyboard shortcuts (ag-dash, the Mac app's quick entry, the session keys) and
standing behaviors like "spin out [bracketed notes]" are rules. Ag ships default rules for the judgments it
makes with Jev (is an archived chat done, where does an inbox capture go, may an agent drive your laptop, does a
tab need renaming) in [`ag-rules/`](ag-rules/), so you can read them, and `ag-rules eject
<name>` copies one into `~/.ag/ag-rules` to change or turn it off. `ag-rules list` shows them all; how they work:
[ag-rules/README.md](ag-rules/README.md).

## The `ag` CLI

`ag help` lists every verb; `ag <verb> --help` explains one. A session argument `<s>` can be a session id,
a tab or pane id, an ag-dash link, or part of the tab's label; with none, the verb acts on the session you're
in. Session verbs run on the host (other machines forward them over SSH). Most take `--json`.

| Command | What it does |
|---|---|
| `ag setup [--pull]`, `ag doctor` | install or update Ag on this machine; check what it still lacks |
| `ag status`, `ag logs <svc> [-f]`, `ag restart <svc>` | health of the whole system; one service's logs; restart it |
| `ag sync` | push the repo and apply it on every machine |
| `ag infra plan\|up\|down\|status` | create and destroy the rented Linux machines (OpenTofu on Hetzner) |
| `ag ls [--inbox\|--needs-you\|--waiting\|--pinned]` | open sessions, most recent first |
| `ag find <words>`, `ag search <description>` | find a session: exact words, or fuzzy (LLM-ranked) |
| `ag read <s>`, `ag peek <s>`, `ag link <s>` | its transcript, its screen right now, its ag-dash link |
| `ag spawn "prompt"`, `ag report "msg"` | open a helper session that reports back; report back to the one that spawned you |
| `ag send <s> "msg"`, `ag merge <A…>` | prompt another session; absorb other sessions into this one |
| `ag close [s]`, `ag resume <s>`, `ag rename`, `ag pin`, `ag wait` | manage tabs: close/reopen, rename, pin, mark waiting |
| `ag routine list\|new\|apply\|run\|log` | recurring jobs: a saved prompt or command on a schedule, one file per job in [`routines/`](routines/) |
| `ag-rules list\|show\|eject` | your rules (`~/.ag/ag-rules`) and ag's defaults: plain-English rules that boil down to code |

Every Ag tool is named `ag-<name>` and also runs as `ag <name>`: `ag-mac` (run things or computer use on ag-mac),
`ag-show` (open a file or page on your screen), `ag-shot` (pull your latest screenshots), `ag-tickler`; plus `op-ag` /
`op-work` (1Password). They live in [`bin/dot-local/bin/`](bin/dot-local/bin/).

## Working on ag

**Everything is in git.** Any change to how a machine is set up goes into this repo in the same task: commit,
push to `main`, then `ag sync` to apply it everywhere. Hand edits outside the repo are lost on the next
rebuild.

**Layout.** Directories named like `bin/dot-local/bin/` are GNU Stow packages: `ag setup` links
`bin/dot-local/bin/ag` to `~/.local/bin/ag`, and so on.

| Path | What |
|---|---|
| `bin/dot-local/bin/` | the `ag` dispatcher and every tool |
| `bin/dot-local/lib/ag/` | `ag` verbs, one executable each (shared helpers in `aglib.py`) |
| `bin/dot-local/lib/ag-mux/` | the session layer: tmux plus agd ([docs/ag-mux.md](docs/ag-mux.md)) |
| `ag-dash/` | the ag-dash page |
| `ag-rules/` | the ag-rules engine (hook contracts, runtime loader) and the default rules |
| `agents.md/` | sources of the global agent instructions; `agents.md/build` generates `pi/dot-pi/agent/AGENTS.md` |
| `agents/` | skills (loaded by Pi, Claude Code and Codex) |
| `pi/`, `claude/`, `codex/` | each agent's config and extensions |
| `systemd-user/`, `macos-launchagents/` | services (Linux host; Macs) |
| `infra/`, `tailscale/`, `machines/` | the VPS (OpenTofu), the tailnet policy, the machine inventory |
| `install`, `bootstrap-linux` | the setup scripts behind `ag setup` (macOS; Linux) |

**Adding a verb.** Drop an executable at `bin/dot-local/lib/ag/<verb>` whose second line reads
`ag <verb> — what it does` (that's what `ag help` shows) and that answers `--help`. Then teach agents about
it in `agents.md/` and run `agents.md/build` (the generated file is untracked; `ag sync` rebuilds it everywhere).

**Tests:** `tests/ag-mux-smoke.sh` exercises the session layer on an isolated tmux server.

## Docs

| Doc | What |
|---|---|
| [docs/onboarding.md](docs/onboarding.md) | build your own Ag from nothing: accounts, tailnet, VPS, ag-mac |
| [docs/reference.md](docs/reference.md) | every component in depth: ag-dash, ag-tickler, ag-presence, ag-mcp-gateway, secrets, … |
| [docs/ag.md](docs/ag.md) | design and roadmap |
| [docs/ag-mux.md](docs/ag-mux.md) | the session layer |
| [infra/README.md](infra/README.md) | building machines with OpenTofu |
| [tmux/SHORTCUTS.md](tmux/SHORTCUTS.md) | keyboard shortcuts on every device |
