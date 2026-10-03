# infra: Ag machines as code

The rented Linux side of Ag (see `docs/ag.md`). OpenTofu + Hetzner Cloud, driven by `ag-infra`:

    ag-infra plan | up | down | scale N | status | ssh [name]

- `up`: creates or updates the engine (and N workers); `down`: destroys machines but **keeps the
  engine's data volume** (`prevent_destroy`), so a later `up` resumes where it left off.
- Owner-specific settings (no defaults in the repo) go in an untracked `infra/hetzner/*.auto.tfvars`,
  which OpenTofu loads automatically (git-ignored here). Keep the real file in your private config and link
  it in (e.g. an ag-personal `links` entry `infra.auto.tfvars ag/infra/hetzner/personal.auto.tfvars`), or
  export `TF_VAR_<name>` instead:

      user          = "you"                              # Linux login on every machine (required)
      ag_repo       = "git@github.com:<owner>/ag.git"    # your ag repo, cloned with the deploy key (required)
      dotfiles_repo = "https://github.com/<owner>/dotfiles.git"  # optional; "" (default) = ag only

  Changing `user` on an existing engine recreates it with a new home, so keep it equal to the current login.
- Secrets come from the work 1Password vault `ag-vault` via `op-work` at run time
  (`Hetzner Cloud` → API token, `Tailscale ag auth key` → auth key). Nothing secret is committed.
- State: `~/.local/state/ag-infra/` on ag-mac (not in git). Move to a remote backend
  (Hetzner Object Storage) before a second machine runs `ag-infra`.
- Machines are reachable only over Tailscale (Tailscale SSH); the Hetzner firewall blocks all
  inbound except Tailscale's UDP port. Break-glass: Hetzner web console.
