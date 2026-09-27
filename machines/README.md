# Machine inventory

Every computer that runs these dotfiles. This table is the source of truth for
"every machine": syncing, SSH aliases, and roles. Add a row when a machine joins,
delete it when one is retired. Per-machine snapshots live in `machines/<LocalHostName>/`
(written by `snapshot`).

Roles:
- **host**: runs the Herdr server, agents, and repos. Agents act from here.
- **client**: where Nathan sits; attaches to a host's Herdr (`ag` command), runs
  Hammerspoon, CleanShot, and the client side of the bridge (`shot`, `show`, `client-cua`).

| SSH alias | LocalHostName | Role | User | Home | Dotfiles checkout | Tailscale IP |
|---|---|---|---|---|---|---|
| `ag` | `ag` | host | `natkoersch` | `/Users/natkoersch` | `~/dotfiles-seen-setup` | `100.107.192.32` |
| `nathan-dev-client` | `nathans-MacBook-Pro-2` | client | `nathan` | `/Users/nathan` | `~/dotfiles` | `100.68.116.104` |

Adding a machine: run `bootstrap`, add its row here and its `Host` block to
`ssh/dot-ssh/config`, authorize SSH keys between it and the host(s), then run
`snapshot --commit` on it.

Scripts that target "the client" or "the host" (`shot`, `show`, `client-cua`,
Hammerspoon's paste upload) default to the aliases above and accept an override
(`SHOT_CLIENT`, `SHOW_CLIENT`, `CLIENT_CUA_HOST`); update the defaults if roles move.
