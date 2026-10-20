# infra: Ag machines as code

The rented Linux side of Ag (see `docs/ag.md`). OpenTofu + AWS EC2 (`infra/aws`), driven by `ag-infra`.
`ag-engine-migrate` moves the session host between machines. (Until 2026-10-19 the engine ran on Hetzner Cloud;
that setup is retired and removed, see git history for `infra/hetzner`.)


    ag-infra plan | up | down | status | ssh [name]
    ag-infra workers                                   # list workers with type, AZ, instance id
    ag-infra workers up [N] [--type T]                 # spin up N workers (default 1) and wait until ready
    ag-infra workers down                              # destroy every worker; the engine is untouched

- `up`: creates or updates the engine (and N workers); `down`: destroys machines but **keeps the
  engine's data volume** (`prevent_destroy`), so a later `up` resumes where it left off.
- **Workers** are scratch machines for big fan-outs (many pi sessions, frame extraction). They run
  `c7a.4xlarge` by default (16 vCPU / 32 GB). The last type is saved in `~/.local/state/ag-infra/aws/workers.env`,
  so `ag-infra up` never
  resizes them. Once a worker is on the tailnet, `workers up` seeds it with what pi needs (models.json
  and `TFY_TOKEN`, in `~/.zshenv.local`) and nothing else secret, so `ssh ag-worker-1 pi -p …` works.
  Tear them down when the job ends: they bill by the hour.
- Owner-specific settings (no defaults in the repo) go in an untracked `infra/aws/*.auto.tfvars`,
  which OpenTofu loads automatically (git-ignored here). Keep the real file in your private config and link
  it in (e.g. an ag-personal `links` entry `infra.auto.tfvars ag/infra/aws/personal.auto.tfvars`), or
  export `TF_VAR_<name>` instead:

      user          = "you"                              # Linux login on every machine (required)
      ag_repo       = "git@github.com:<owner>/ag.git"    # your ag repo, cloned with the deploy key (required)
      dotfiles_repo = "https://github.com/<owner>/dotfiles.git"  # optional; "" (default) = ag only
      ssh_public_key = "ssh-ed25519 …"                   # ag-mac's key: break-glass SSH (required)
      owner         = "you@work"                         # optional Owner tag on every AWS resource

  Changing `user` on an existing engine recreates it with a new home, so keep it equal to the current login.
- Secrets come from the work 1Password vault `ag-vault` via `op-work` at run time
  (`Tailscale ag auth key` → workers' ephemeral auth key, `ag repo deploy key`). The engine joins with a
  single-use, non-ephemeral key that `ag-infra` mints per run through the Tailscale OAuth client (`ag-ts-api`),
  so it stays on the tailnet while stopped. Nothing secret is committed.
- State: `~/.local/state/ag-infra/aws/` on the session host, ag-engine (not in git; the ag-state archive
  snapshots it). Move to a remote backend (S3) before a second machine runs `ag-infra`.
- Machines are reachable only over Tailscale (Tailscale SSH); the security group blocks all
  inbound except Tailscale's UDP port. Break-glass: `ag-engine-rescue` (below).

## US only

Every Ag machine runs in the US. AWS can't enforce this at the account level (restricting regions needs an
org-level SCP), so the code does: `infra/aws` only accepts `us-*` regions (not GovCloud), and OpenTofu refuses
any other region before calling AWS.

## AWS specifics

- Credentials: `AWS_PROFILE`, else `AG_AWS_PROFILE` in `~/ag-personal/env`. The account needs EC2, EBS and IAM rights.
  On the engine that profile holds only a region: credentials come from the instance role `ag-machine`
  (`machine_policy_arn`, AdministratorAccess by default), so no access key lives on any machine.
- Uses the account's **default VPC** (one default subnet in `availability_zone`; shared accounts often hit the VPC
  limit). The security group `ag-tailnet-only` allows inbound UDP 41641 (Tailscale) and ICMP only.
- The engine's data volume is a gp3 EBS volume in the same AZ (`prevent_destroy`, encrypted), mounted at /data;
  cloud-init waits for it to attach and formats it only when it has no filesystem yet.
- **Instance role `ag-machine`** (no access keys on the machines): PowerUserAccess + IAMReadOnlyAccess, plus the
  inline `ag-guardrails` policy: it may pass only itself to EC2, and may never touch CloudTrail/GuardDuty, its own
  alerts, Organizations/account settings, or create access keys/logins. It can't change its own permissions, so
  edits to ag-machine (and to the alerts) need your own admin credentials (e.g. `AWS_PROFILE=<you> ag-infra up`).
- **Engine alerts** (`alerts.tf`, set `alert_email` in your tfvars): EventBridge emails you on every console shell or
  SSM command on the engine, snapshot/detach/modify of its disks, stop/terminate/modify/image/screenshot of the
  instance, any change to the ag-machine role, and any machine launched with it. Confirm the SNS email once.
- **No AWS console shell.** bootstrap-linux disables the SSM agent and the role has no SSM-core policy, so other
  admins in a shared account can't open a shell on the machines. (Disabling the agent matters: an account's Default
  Host Management Configuration can register instances without any instance-profile permissions.)
- **Break-glass when Tailscale is down: `ag-engine-rescue open`** from your Mac (your own AWS credentials) opens
  port 22 to your current public IP only and prints the ssh command (keys only: ag-mac's `ssh_public_key` plus
  `extra_ssh_public_keys`, e.g. your client Mac's). Fix Tailscale, then `ag-engine-rescue close`. Last resort if
  sshd or networking is broken: stop the instance, attach its root disk to a rescue instance in the same AZ (your
  user can use the disk key), repair, reattach.
- **Disk key** (`disk_kms_key_arn`): a customer-managed KMS key whose policy lists only you and `ag-machine`, so
  snapshots or copies of the engine's disks are useless to other admins. Create it outside OpenTofu; if every
  listed principal is lost, recovery goes through the account root and AWS Support.
- Resize the engine with `ag-infra up -var engine_type=…` (stop/start). Add `owner = "you@work"` to your tfvars to
  tag every resource with an Owner.
