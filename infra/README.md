# infra: Ag machines as code

The rented Linux side of Ag (see `docs/ag.md`). OpenTofu + Hetzner Cloud, driven by `ag-infra`:

    ag-infra plan | up | down | scale N | status | ssh [name]

- `up`: creates or updates the brain (and N workers); `down`: destroys machines but **keeps the
  brain's data volume** (`prevent_destroy`), so a later `up` resumes where it left off.
- Secrets come from the work 1Password vault `ag-shared` via `op-work` at run time
  (`Hetzner Cloud` → API token, `Tailscale ag auth key` → auth key). Nothing secret is committed.
- State: `~/.local/state/ag-infra/` on ag-mac (not in git). Move to a remote backend
  (Hetzner Object Storage) before a second machine runs `ag-infra`.
- Machines are reachable only over Tailscale (Tailscale SSH); the Hetzner firewall blocks all
  inbound except Tailscale's UDP port. Break-glass: Hetzner web console.
