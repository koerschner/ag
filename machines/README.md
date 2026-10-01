# Machine inventory

Every computer that runs ag and dotfiles. This table is the source of truth for
"every machine": syncing, SSH aliases, and roles. Add a row when a machine joins,
delete it when one is retired. Per-machine snapshots live in `machines/<LocalHostName>/`
(written by `snapshot`).

Roles:
- **engine** (Ag, Linux): rented, rebuilt from zero by `ag-infra` (infra/hetzner) + `bootstrap-linux`; persistent state on a volume at /data. Design: `docs/ag.md`. Sync it like the others (`git pull --ff-only` in `~/ag` and `~/dotfiles`, re-run `~/ag/bootstrap-linux` if it changed).
- **host**: runs Ag's sessions (ag-mux on tmux), every Ag service, and the repos. Agents act from here. Today: ag-engine (Linux, Hetzner CCX33 in Hillsboro).
- **extremity**: the always-on Mac Ag drives for computer use and Mac-only apps and CLIs (ag-mac). No sessions or Ag services; it never sleeps.
- **client**: where Nathan sits; runs no sessions. Attaches to the host's tmux
  (`ag` command = `ssh -t <host> ag-mux attach`), runs Hammerspoon, CleanShot, and the client side
  of the bridge (`shot`, `show`, `client-cua`). Client shortcuts only translate keys
  into tmux prefix chords; anything that executes is a tmux binding on the host (`ag.tmux.conf`).
  Full rules: "Multi-machine setup model: host and client" in `pi/dot-pi/agent/AGENTS.md`.

| SSH alias | LocalHostName | Role | User | Home | ag checkout | Dotfiles checkout | Tailscale IP |
|---|---|---|---|---|---|---|---|
| `ag-mac` | `ag-mac` | extremity | `natkoersch` | `/Users/natkoersch` | `~/ag` | `~/dotfiles-seen-setup` | `100.107.192.32` |
| `ag-client` | `ag-client` | client | `nathan` | `/Users/nathan` | `~/ag` | `~/dotfiles` | `100.68.116.104` |
| `ag-engine` | `ag-engine` | host | `nathan` | `/home/nathan` | `~/ag` | `~/dotfiles` | changes on rebuild; use MagicDNS `ag-engine` |

Names (settled 2026-09-29; Tailscale device name = SSH alias = LocalHostName): **ag-engine** (rented Linux),
**ag-mac** (the 2024 MacBook, formerly `ag`), **ag-client** (the Mac Nathan sits at, formerly `nathan-dev-client`),
and **ag-phone** (Nathan's iPhone, Tailscale `ag-phone`, formerly `iphone-15-pro-max`; it runs neither repo, so
it has no row). The old names stay as extra SSH aliases, and `ag` stays in both Macs' `/etc/hosts` (dotfiles
`macos`) so old `http://ag:…` links still open, until nothing uses them. (`machine-role` accepts a
comma-separated LocalHostName list for future renames.)

The ag repo is private. Machines where agents don't push (the client, workers) clone it read-only with
the `ag repo deploy key` from ag-vault (`~/.ssh/ag-deploy`, set as the checkout's `core.sshCommand`); the
session host pushes with Nathan's GitHub credentials (on ag-engine: https remote + `gh auth setup-git`, no `core.sshCommand`).

`machine-role` prints this Mac's role from the table (unlisted = client); role-specific
setup uses it, e.g. sleep: hosts never sleep, clients sleep normally (`macos`, Hammerspoon's battery guard).

Adding a machine: run dotfiles' `bootstrap` (it clones and installs ag) or ag's `bootstrap-linux`, add its
row here and its `Host` block to dotfiles' `ssh/dot-ssh/config`, authorize SSH keys between it and the
host(s), then run dotfiles' `snapshot --commit` on it (snapshots live in dotfiles' `machines/<host>/`).

Scripts that target "the client" or "the host" (`shot`, `show`, `client-cua`,
Hammerspoon's paste upload) default to the aliases above and accept an override
(`SHOT_CLIENT`, `SHOW_CLIENT`, `CLIENT_CUA_HOST`); update the defaults if roles move.
