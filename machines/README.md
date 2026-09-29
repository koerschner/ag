# Machine inventory

Every computer that runs these dotfiles. This table is the source of truth for
"every machine": syncing, SSH aliases, and roles. Add a row when a machine joins,
delete it when one is retired. Per-machine snapshots live in `machines/<LocalHostName>/`
(written by `snapshot`).

Roles:
- **brain** (Ag, Linux): rented, rebuilt from zero by `ag-infra` (infra/hetzner) + `bootstrap-linux`; persistent state on a volume at /data. Design: `docs/ag.md`. Sync it like the others (`git pull --ff-only` in `~/dotfiles`, re-run `bootstrap-linux` if it changed).
- **host**: runs the Herdr server, agents, and repos. Agents act from here.
- **client**: where Nathan sits; runs no Herdr server. Attaches to a host's Herdr
  (`ag` command, host keybindings), runs Hammerspoon, CleanShot, and the client side
  of the bridge (`shot`, `show`, `client-cua`). Client shortcuts only translate keys
  into Herdr chords; anything that executes is a Herdr `keys.command` on the host.
  Full rules: "Multi-machine setup model: host and client" in `pi/dot-pi/agent/AGENTS.md`.

| SSH alias | LocalHostName | Role | User | Home | Dotfiles checkout | Tailscale IP |
|---|---|---|---|---|---|---|
| `ag` | `ag` | host | `natkoersch` | `/Users/natkoersch` | `~/dotfiles-seen-setup` | `100.107.192.32` |
| `nathan-dev-client` | `nathans-MacBook-Pro-2` | client | `nathan` | `/Users/nathan` | `~/dotfiles` | `100.68.116.104` |
| `ag-brain` | `ag-brain` (Linux, Hetzner CCX33 in Hillsboro) | brain (Ag; being set up, not yet the Herdr host) | `nathan` | `/home/nathan` | `~/dotfiles` | changes on rebuild; use MagicDNS `ag-brain` |

`machine-role` prints this Mac's role from the table (unlisted = client); role-specific
setup uses it, e.g. sleep: hosts never sleep, clients sleep normally (`macos`, Hammerspoon's battery guard).

Adding a machine: run `bootstrap`, add its row here and its `Host` block to
`ssh/dot-ssh/config`, authorize SSH keys between it and the host(s), then run
`snapshot --commit` on it.

Scripts that target "the client" or "the host" (`shot`, `show`, `client-cua`,
Hammerspoon's paste upload) default to the aliases above and accept an override
(`SHOT_CLIENT`, `SHOW_CLIENT`, `CLIENT_CUA_HOST`); update the defaults if roles move.
