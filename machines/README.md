# Machine inventory

Every computer that runs ag and dotfiles. The inventory table is the source of truth for
"every machine": syncing, SSH aliases, and roles. Add a row when a machine joins,
delete it when one is retired. Per-machine snapshots live in `machines/<LocalHostName>/`
(written by `snapshot`).

**Your real table is private.** Ag reads `~/ag-personal/machines.md` (your private ag-personal repo) when it
exists, and this file only otherwise (`aglib.machines()` for `ag sync`/`ag status`/`ag doctor`, `ag-host`,
`ag-machine-role`). Copy this file there and put your own rows in it, so usernames and homes stay out of this
public repo. The table below is a generic example in the same format: the parsers read rows whose first cell
starts with `ag-` and whose Role is one of host, extremity, client, engine, worker.

Roles:
- **engine** (Ag, Linux): rented, rebuilt from zero by `ag-infra` (infra/hetzner) + `bootstrap-linux`; persistent state on a volume at /data. Design: `docs/ag.md`. Sync it like the others (`git pull --ff-only` in `~/ag` and `~/dotfiles`, re-run `~/ag/bootstrap-linux` if it changed).
- **host**: runs Ag's sessions (ag-mux on tmux), every Ag service, and the repos. Agents act from here. Typically ag-engine (rented Linux).
- **extremity**: the always-on Mac Ag drives for computer use and Mac-only apps and CLIs (ag-mac). No sessions or Ag services; it never sleeps.
- **client**: where you sit; runs no sessions. Attaches to the host's tmux
  (`ag` command = `ssh -t <host> ag-mux attach`), runs Hammerspoon, CleanShot, and the client side
  of the bridge (`ag-shot`, `ag-show`, `ag-client-cua`). Client shortcuts only translate keys
  into tmux prefix chords; anything that executes is a tmux binding on the host (`ag.tmux.conf`).
  Full rules: "Multi-machine setup model: host and client" in `pi/dot-pi/agent/AGENTS.md`.

| SSH alias | LocalHostName | Role | User | Home | ag checkout | Dotfiles checkout |
|---|---|---|---|---|---|---|
| `ag-mac` | `ag-mac` | extremity | `you` | `/Users/you` | `~/ag` | `~/dotfiles` |
| `ag-client` | `ag-client` | client | `you` | `/Users/you` | `~/ag` | `~/dotfiles` |
| `ag-engine` | `ag-engine` | host | `you` | `/home/you` | `~/ag` | `~/dotfiles` |

Names (Tailscale device name = SSH alias = LocalHostName): **ag-engine** (rented Linux), **ag-mac** (the
always-on Mac), **ag-client** (the Mac you sit at), and **ag-phone** (your iPhone; it runs neither repo, so it
has no row). Former names can stay as extra SSH aliases until nothing uses them. (`ag-machine-role` accepts a
comma-separated LocalHostName list for renames.)

The ag repo is private. Machines where agents don't push (the client, workers) clone it read-only with
the `ag repo deploy key` from ag-vault (`~/.ssh/ag-deploy`, set as the checkout's `core.sshCommand`); the
session host pushes with your GitHub credentials (on ag-engine: https remote + `gh auth setup-git`, no `core.sshCommand`).

`ag-machine-role` prints this Mac's role from the table (unlisted = client); role-specific
setup uses it, e.g. sleep: hosts never sleep, clients sleep normally (`macos`, Hammerspoon's battery guard).

Adding a machine: run dotfiles' `bootstrap` (it clones and installs ag) or ag's `bootstrap-linux`, add its
row to your inventory and its `Host` block to dotfiles' `ssh/dot-ssh/config`, authorize SSH keys between it and the
host(s), then run dotfiles' `snapshot --commit` on it (snapshots live in dotfiles' `machines/<host>/`).

Scripts that target "the client" or "the host" (`ag-shot`, `ag-show`, `ag-client-cua`,
Hammerspoon's paste upload) default to the aliases above and accept an override
(`SHOT_CLIENT`, `SHOW_CLIENT`, `CLIENT_CUA_HOST`); update the defaults if roles move.
