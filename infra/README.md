# infra: Ag machines as code

The rented Linux side of Ag (see `docs/ag.md`). OpenTofu + AWS EC2 (`infra/aws`), driven by `ag-infra`.
`infra/hetzner` (and `ag-infra-hetzner`) is the previous home, kept only until the old engine is decommissioned.

    ag-infra console [name]                            # break-glass shell over SSM Session Manager

    ag-infra plan | up | down | status | ssh [name]
    ag-infra workers                                   # list workers with type, location, $/hour
    ag-infra workers up [N] [--type T] [--location L]  # spin up N workers (default 1) and wait until ready
    ag-infra workers down                              # destroy every worker; the engine is untouched

- `up`: creates or updates the engine (and N workers); `down`: destroys machines but **keeps the
  engine's data volume** (`prevent_destroy`), so a later `up` resumes where it left off.
- **Workers** are scratch machines for big fan-outs (many pi sessions, frame extraction). They run
  shared-vCPU types in the EU (default `cpx62`: 16 vCPU / 32 GB / 640 GB, about $0.25/hour) because
  dedicated types count against the account's dedicated-vCPU limit, which the engine fills. When a type
  is sold out in one location (`resource_unavailable`), `workers up` tries nbg1, fsn1 and hel1 in turn.
  The last type and location are saved in `~/.local/state/ag-infra/workers.env`, so `ag-infra up` never
  resizes them. Once a worker is on the tailnet, `workers up` seeds it with what pi needs (models.json
  and `TFY_TOKEN`, in `~/.zshenv.local`) and nothing else secret, so `ssh ag-worker-1 pi -p …` works.
  Tear them down when the job ends: they bill by the hour.
- Owner-specific settings (no defaults in the repo) go in an untracked `infra/hetzner/*.auto.tfvars`,
  which OpenTofu loads automatically (git-ignored here). Keep the real file in your private config and link
  it in (e.g. an ag-personal `links` entry `infra.auto.tfvars ag/infra/hetzner/personal.auto.tfvars`), or
  export `TF_VAR_<name>` instead:

      user          = "you"                              # Linux login on every machine (required)
      ag_repo       = "git@github.com:<owner>/ag.git"    # your ag repo, cloned with the deploy key (required)
      dotfiles_repo = "https://github.com/<owner>/dotfiles.git"  # optional; "" (default) = ag only
      ssh_public_key = "ssh-ed25519 …"                   # ag-mac's key: break-glass SSH (required)

  Changing `user` on an existing engine recreates it with a new home, so keep it equal to the current login.
- Secrets come from the work 1Password vault `ag-vault` via `op-work` at run time
  (`Hetzner Cloud` → API token, `Tailscale ag auth key` → auth key). Nothing secret is committed.
- State: `~/.local/state/ag-infra/` on the session host, ag-engine (not in git; moved from ag-mac on
  2026-10-13, whose old copy is renamed `ag-infra.moved-to-ag-engine-*`). Move to a remote backend
  (Hetzner Object Storage) before a second machine runs `ag-infra`.
- Machines are reachable only over Tailscale (Tailscale SSH); the Hetzner firewall blocks all
  inbound except Tailscale's UDP port. Break-glass: Hetzner web console.

## AWS specifics (infra/aws)

- Credentials: `AWS_PROFILE`, else `AG_AWS_PROFILE` in `~/ag-personal/env`. The account needs EC2, EBS and IAM rights.
- Uses the account's **default VPC** (one default subnet in `availability_zone`; shared accounts often hit the VPC
  limit). The security group `ag-tailnet-only` allows inbound UDP 41641 (Tailscale) and ICMP only.
- The engine's data volume is a gp3 EBS volume in the same AZ (`prevent_destroy`, encrypted), mounted at /data;
  cloud-init waits for it to attach and formats it only when it has no filesystem yet.
- Break-glass is SSM Session Manager (`ag-infra console`, instance role `ag-machine`), not a web console.
- Resize the engine with `ag-infra up -var engine_type=…` (stop/start). Add `owner = "you@work"` to your tfvars to
  tag every resource with an Owner.
