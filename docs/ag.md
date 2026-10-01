# Ag

Status: **in progress** (started 2026-09-28 in the "Cloud VM Setup" session). First engine `ag-engine` is up (2026-09-29): Hetzner CCX33 (8 vCPU/32 GB; the account is capped at 8 dedicated vCPUs until Hetzner allows a limit request), Hillsboro, joined to the tailnet, `bootstrap-linux` clean, Pi working. Today everything
still runs on ag-mac (the Mac formerly called `ag`, renamed 2026-09-29); this doc is the target and the source of truth for what goes where.

## What Ag is

Ag is Nathan's whole agent system, not one computer. Names: the **engine** (`ag-engine`, formerly "brain") does the work; **ag-mac** is the Mac it reaches into; **workers** scale out.

| Part | What it is | Runs |
|---|---|---|
| **Engine** | Rented Linux machine(s), built from zero by IaC | Herdr server, every Pi session, repos and worktrees, builds, tests, Docker, MCP servers, inbox, tickler, `show`, and phone review |
| **Workers** | More rented Linux machines, created and destroyed on demand | Heavy or parallel jobs sent from the engine (big test suites, many agents at once) |
| **ag-mac** | The 2024 MacBook (formerly `ag`) | Only what needs macOS: computer use, Mac-only apps (the ChatGPT app; the Discord app only as a fallback to the `discord` CLI), Xcode and macOS/iOS builds, native UI renders, Roblox Studio, Keychain items, macOS permission prompts |
| **Client** | `ag-client` (formerly `nathan-dev-client`) and `ag-phone` (the iPhone) | Where Nathan sits. It attaches to the engine's Herdr and runs Hammerspoon, CleanShot, and the client side of the bridge. Unchanged. |

Everything is joined by one Tailscale tailnet.

## How it works

- **One session store.** Every session lives on the engine; there is no Herdr server on ag-mac. The
  client's attach command (today `ag`) points at the engine.
- **Reaching into the Mac, not routing.** Nothing decides upfront where a query should go. Agents
  on the engine have a `mac` tool/command that runs a task on ag-mac over Tailscale:
  `mac cua "<task>"` for computer use, `mac run <cmd>` for Mac-only CLIs and builds, and file transfer
  in both directions. An agent calls it when it finds, partway through a task, that it needs the Mac.
  (It generalizes today's `client-cua`.) Jev may still send obviously Mac-only inbox captures straight
  to ag-mac as a shortcut, but that's optional.
- **Scoped access.** The engine uses a dedicated SSH key or Tailscale SSH identity on ag-mac, allowed
  only from the tailnet and limited to the `mac` entry points.
- **Ephemeral and IaC.** One command (`ag-infra up`) builds a engine or worker from nothing: Terraform/OpenTofu
  creates the machine, cloud-init joins Tailscale with an ephemeral, pre-authorized tagged key, and it
  clones the ag repo (read-only deploy key) and runs its `bootstrap-linux`, which also installs the public dotfiles, and pulls secrets through the 1Password service account.
  `ag-infra scale N` adds or removes workers, and `ag-infra down` destroys machines but keeps the engine's data volume. Any machine can be thrown away
  and rebuilt.

## Persistence (because machines are ephemeral)

Nothing important may live only on a machine's local disk.

| State | Where it lives |
|---|---|
| Pi session transcripts | A persistent volume on the engine for speed, plus the **pi-sessions GitHub archive** (below) as the durable off-site copy |
| Code | Git remotes. Worktrees push WIP branches often, so a rebuilt engine can recreate them. |
| Herdr layout (workspaces, tabs, and which session each tab resumes) | Snapshotted regularly with `herdr api snapshot` and restored on a new engine, so tabs come back and resume their Pi sessions |
| Tickler items, inbox and tickler logs, `~/inbox` files | The engine's persistent volume, also backed up to the archive |
| Secrets | The 1Password service account only (never in a repo or image) |
| Machine setup | The ag repo (agent system + IaC) plus dotfiles (personal config) |

### pi-sessions archive (decided in the merged "Pi Sync" session, 2026-09-27)

- A private repo on Nathan's personal GitHub (`koerschner`), laid out as
  `machines/<machine>/<project>/<session>.jsonl`.
- **Redact, then encrypt.** gitleaks-style patterns replace secrets with `[REDACTED:<type>]`, then
  git-crypt encrypts every file. The originals stay untouched locally. A scan found 473 transcripts
  containing token-shaped strings, which is why both steps are used.
- **Keep images.** Base64 images are kept even though they barely compress.
- **Commit cadence.** The original plan was daily; with ephemeral machines it needs to be frequent
  (every few minutes, plus on shutdown). Files still being written are handled with a quiet-period rule.
- **Rolling volumes.** Repos are named `pi-sessions-001`, `-002`, and so on. `volumes.json` marks the
  current one. At about 4 GB the script creates the next volume with the same key and archives the old
  one. The newest volume holding a file has its latest version. The first backfill (about 2.7 GB)
  is pushed in batches of about 500 MB, because GitHub rejects any push over 2 GB.
- **Key.** The git-crypt key goes in each machine's secret store, plus an offline copy in Nathan's
  **personal** 1Password.
- **Second use.** The archive also feeds the AGENTS.md section-usage analysis: score each section by
  how often it is relevant × how often it changes the outcome, and send a weekly suggestions report.
  It never edits the file automatically.

## Provider (researched 2026-09-28)

- **Primary: Hetzner Cloud, Hillsboro (HIL).**
  - Engine: CCX53 (32 vCPU/128 GB, ~€533/mo) or CCX63 (48/192, ~€853/mo), with dedicated vCPUs.
  - Workers: CCX33 or CCX43 built from a Packer snapshot, billed hourly.
  - Tooling: the best `hcloud` CLI and Terraform experience at this price, plus Volumes and snapshots.
  - Gotchas:
    - New accounts have low vCPU limits, so file a limit-increase ticket first.
    - Prices doubled in June 2026.
    - US traffic allowance is small.
    - No dedicated servers in the US.
- **Runner-up: Vultr VX1.**
  - ~$701 for 32/128, billed per hour.
  - More US regions, including Seattle.
  - Bare metal through the same API and Terraform provider.
- **Bare-metal alternative for the engine: Latitude.sh.** 16 cores/128 GB in LA for ~$456/mo, hourly,
  with Terraform.
- **Future cloud Mac:** EC2 Mac, about $900/mo per machine because of the 24-hour minimum. Not needed
  while ag-mac exists.
- **Sandboxes** (Morph for running-VM branching, Daytona for fork/snapshot, Fly Sprites): not on day one.
  Worktrees plus Docker cover per-task isolation. Add one later for per-task forks.
- **Payment:** the Ramp card (see AGENTS.md).

## Rollout

1. Upgrade Tailscale for tagged ephemeral nodes and API/Terraform access (split-out session
   "Upgrade Tailscale Plan").
2. ✅ IaC (`infra/hetzner`, `ag-infra up`/`down`, verified by a full destroy + rebuild), ✅ `bootstrap-linux` (idempotent, clean run). ✅ One engine up. Left: MCP server auth on the engine, and moving to CCX53 once allowed.
3. ✅ Persistent volume layout (/data bind mounts). ✅ pi-sessions archive: `pi-sessions-sync` (README "Pi sessions archive"), hourly on the host (plus the client over SSH) and on the engine.
4. ✅ `mac` tool (`bin/dot-local/bin/mac`: run, cua, push/pull, show, status) over the engine's own SSH key (ag-vault "ag-brain → ag-mac SSH key" (id vqpozjumzkuz7sgdcdgvdpaujq; the CLI can't rename SSH-key items), authorized on ag-mac only from tailnet IPs); tested run, files, computer use. ✅ MCP on the engine with zero per-machine auth: `mcp-tunnel` (systemd user unit) forwards 127.0.0.1:7381-7384 to ag-mac's shared gateway; Slack's OAuth file copied. When the engine becomes the host, the gateway moves there and auth lives in exactly one place.
5. Move arcade dev onto the engine as the real test.
6. ✅ (2026-09-29) Sessions and every Ag service moved to the engine: Herdr replaced by ag-mux on tmux, LaunchAgents became systemd
   units, links use the Tailscale Service `ag`, and `ag` on the client attaches to the engine. docs/tmux-port.md.
7. ✅ Renamed `ag` → `ag-mac`, `nathan-dev-client` → `ag-client`, the iPhone → `ag-phone` everywhere
   (Tailscale, SSH aliases, LocalHostNames, `machines/README.md`, docs, AGENTS.md; 2026-09-29). Left: shrink
   ag-mac to the Mac-worker role.
