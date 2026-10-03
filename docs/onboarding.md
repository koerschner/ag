# Onboarding: build your own Ag

This guide builds a complete Ag of your own from nothing: a Linux VPS that runs the agent sessions (the
**engine**), a private Tailscale network joining your machines, a Mac that agents drive for computer use
(**ag-mac**), and your laptop (the **client**). It's every step in order, with the exact commands.

> **Fastest path:** open the ChatGPT desktop app on your Mac, turn on computer use, and give it this
> file: *"Set me up by following docs/onboarding.md in github.com/koerschner/ag. Hand the keyboard back to
> me for payments, 2FA codes and ID checks."* Stay nearby: you'll only be needed for those steps.

Ag was built for one person (Nathan), so a few names are hard-coded. Step 2 lists them; you change them
in your own fork.

| Machine | What it is | Required? |
|---|---|---|
| **engine** | Ubuntu 24.04 VPS (Hetzner). Runs every agent session in tmux and all Ag services | yes |
| **client** | the laptop you sit at. Attaches to the engine with `ag` | yes |
| **ag-mac** | an always-on Mac (never sleeps) for computer use and Mac-only apps | optional; skip it at first |
| **phone** | iPhone with Tailscale + Moshi or the AG Dash web app | optional |

Budget roughly: Hetzner CCX33 ≈ $60/mo, Tailscale Premium $18/mo (Personal is free but non-commercial),
1Password Teams/Business (service accounts), plus your model subscriptions.

---

## 1. Accounts and payments

Create these (use a work card if your company pays). Turn on 2FA everywhere.

| Service | What to get | Used for |
|---|---|---|
| **GitHub** | an account; you'll fork `koerschner/ag` | your copy of Ag |
| **Tailscale** | a tailnet (Premium if it's for work; Personal for a trial) | joins every machine; SSH between them |
| **Hetzner Cloud** | an account and a project, payment method added | the engine VPS. New accounts can need ID verification (hours to a day) and are capped at 8 dedicated vCPUs at first |
| **1Password** | a Teams or Business account (service accounts need one) | where agents read secrets from |
| **Models** | at least one: Claude (Pro/Max), ChatGPT (Plus/Pro), or an API key (Anthropic, OpenAI, OpenRouter) | the agents themselves. ChatGPT is also what powers computer use on ag-mac |

## 2. Fork the repo and make it yours

```sh
gh repo fork koerschner/ag --clone=false      # or fork on github.com
git clone git@github.com:<you>/ag.git ~/ag
```

Edit these in your fork, commit, and push to `main`:

- **`machines/README.md`**: replace the machine table with your own rows (SSH alias, LocalHostName, role,
  user, home). Keep the aliases `ag-engine` and `ag-mac` if you can: scripts default to those names.
- **Tailnet name**: Nathan's is `tail44736d.ts.net`. Find and replace it with yours (Tailscale admin →
  DNS → tailnet name): `rg -l tail44736d` (about six files).
- **`tailscale/policy.hujson`**: replace Nathan's email in `tests`/`sshTests` with yours.
- **`infra/hetzner/variables.tf`**: `user` default (`nathan`) → your Linux username; `ag_repo` → your fork;
  `location` if you're not on the US West Coast (`ash` = Virginia, `nbg1`/`fsn1` = Germany).
- **Agent instructions** (`agents.md/sections/`): these are Nathan's. At least rewrite
  `015-about-nathan.md` about yourself, and delete the sections that are his (Arcade, Discord, his payment
  cards). Replace "Nathan" with your name where it means the user. Then `agents.md/build`.
- **`bootstrap-linux`**: the `ag-engine → ag-mac SSH key` is fetched by a fixed 1Password item ID; if you
  use ag-mac, change that ID to your item's (step 4), or place the key by hand (step 7).

## 3. Tailscale

1. In the admin console: **DNS** → enable MagicDNS. Note your tailnet name (`tailXXXX.ts.net`).
2. **Access controls**: paste your fork's `tailscale/policy.hujson` and save. It defines the tags
   `tag:ag-engine` / `tag:ag-worker`, lets your own devices reach everything, and turns on Tailscale SSH.
3. **Services** → create a service named `ag` (`svc:ag`), ports TCP 7373–7377. This is the
   machine-independent address (`http://ag:7376` = AG Dash) that the engine advertises.
4. **Settings → Keys** → generate an auth key: reusable, ephemeral, pre-approved, tags `tag:ag-engine` and
   `tag:ag-worker`. Save it in 1Password (step 4).
5. Install Tailscale on your laptop (and ag-mac, phone) and sign in. On Macs: Settings → **Launch
   Tailscale at login**. Name each device to match its SSH alias (`ag-mac`, …).

## 4. 1Password

1. Create a vault named **`ag-vault`**. Note its ID (`op vault list`).
2. Create a **service account** with read and write on `ag-vault` only. Save its token somewhere safe
   (a personal 1Password item): it's shown once.
3. Add these items to `ag-vault`. The names must match exactly; `ag infra` reads them:

| Item | Field | Value |
|---|---|---|
| `Hetzner Cloud` | `credential` | Hetzner Cloud API token (project → Security → API tokens, Read & Write) |
| `Tailscale ag auth key` | `credential` | the auth key from step 3 |
| `ag repo deploy key` | `private key` | an SSH key pair you generate (`ssh-keygen -t ed25519 -f deploy -N ''`); add `deploy.pub` to your fork → Settings → Deploy keys (read-only) |
| `ag-engine → ag-mac SSH key` | `private key` | only with ag-mac: another key pair; its `.pub` goes in ag-mac's `~/.ssh/authorized_keys` |

4. Point Ag at your vault: `export AG_INFRA_VAULT=<vault id>` in `~/.zshenv.local`.

## 5. Your laptop (client) and the machine that creates the VPS

`ag infra` (OpenTofu) runs from a Mac: ag-mac if you have one, otherwise your laptop.

Install [Homebrew](https://brew.sh) first. Setup links Ag's agent instructions and config into `~/.pi`,
`~/.claude` and `~/.codex`; any existing files there are moved to `~/.dotfiles-backup/<date>/`.

```sh
~/ag/bin/dot-local/bin/ag setup --no-dotfiles   # installs pi, claude, codex, bun, gh, op, uv, stow…
brew install opentofu
gh auth login && gh auth setup-git
git config --global user.name "…"; git config --global user.email "…"
```

Store the 1Password service-account token in the login Keychain (the `op-work` wrapper reads it there):

```sh
security add-generic-password -a "$USER" -s "ag-shared 1Password service account" -T /usr/bin/security -w
# paste the token at the prompt
op-work vault list    # should list ag-vault
```

Make sure `~/.ssh/id_ed25519.pub` exists (`ssh-keygen -t ed25519` if not): it becomes the engine's
break-glass SSH key.

## 6. The engine (VPS)

### Option A: `ag infra up` (recommended; rebuildable)

```sh
ag infra plan        # check what it will create
ag infra up          # firewall (Tailscale only), 200 GB data volume, CCX33 server
```

Cloud-init then creates your user, mounts the volume at `/data`, joins the tailnet as `ag-engine`, clones
your fork, and runs `bootstrap-linux`. Allow 5–10 minutes, then `ssh ag-engine` (Tailscale SSH, no key
needed). Watch progress with `sudo tail -f /var/log/cloud-init-output.log`.

Only port 41641/udp is open to the internet. If Tailscale ever breaks, Hetzner's web console is the way in.

### Option B: any Ubuntu 24.04 VPS, by hand

```sh
# on the VPS, as a sudo user (not root)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=ag-engine --advertise-tags=tag:ag-engine
git clone https://github.com/<you>/ag.git ~/ag
~/ag/bin/dot-local/bin/ag setup --no-dotfiles
```

### Then, on the engine

```sh
pi                                  # then /login for each model provider
gh auth login && gh auth setup-git
mkdir -p ~/.config/ag && install -m 600 /dev/null ~/.config/ag/op-work.token && $EDITOR ~/.config/ag/op-work.token   # service-account token
ag-svc local                        # advertise http://ag:7373–7377 on the tailnet
ag doctor                           # lists anything still missing
ag status
```

Optional: `TFY_TOKEN` in `~/.zshenv.local` routes models through a TrueFoundry gateway; without it each
tool uses its own login.

## 7. SSH between machines

You're skipping Nathan's dotfiles, so add the host aliases yourself in `~/.ssh/config` on each machine
(the client, ag-mac, the engine):

```sshconfig
Host ag-engine
    HostName ag-engine.<tailnet>.ts.net
    User <your linux user>

Host ag-mac
    HostName ag-mac.<tailnet>.ts.net
    User <your mac user>
    IdentityFile ~/.ssh/ag-mac      # on the engine; id_ed25519 elsewhere
    IdentitiesOnly yes

Host ag-client
    HostName <laptop>.<tailnet>.ts.net
    User <your mac user>
```

On the engine, put the `ag-engine → ag-mac SSH key` private key at `~/.ssh/ag-mac` (mode 600), and its
public key in ag-mac's (and the laptop's, for `show`/`shot`) `~/.ssh/authorized_keys`. Turn on **System
Settings → General → Sharing → Remote Login** on those Macs. Test from the engine: `mac status`.

## 8. ag-mac (optional: computer use and Mac-only apps)

Any Mac that stays on: plugged in, never sleeps, signed in, Tailscale at login.

1. Add its row to `machines/README.md` with role `extremity`, push, then on it:
   `git clone git@github.com:<you>/ag.git ~/ag && ~/ag/bin/dot-local/bin/ag setup --no-dotfiles`.
2. Keychain items `install` asks for (`ag doctor` lists them): the 1Password service-account token(s), as
   in step 5, and its own login password via `ag-login-password set`, so agents can answer admin prompts.
3. Install the **ChatGPT desktop app**, sign in, and enable computer use. Agents call it through
   `mac cua "…"` (the `chatgpt-cua` wrapper, one job at a time).
4. Permissions: agent commands arrive over SSH, so grant **Full Disk Access, Accessibility and Screen &
   System Audio Recording** to `/usr/libexec/sshd-keygen-wrapper` (System Settings → Privacy & Security →
   `+` → Cmd+Shift+G). Check with `ag access`; answer later prompts with `ag access allow`.
5. Test from the engine: `mac run sw_vers`, then `mac cua "open Safari and tell me the page title"`.

## 9. Check that it works

From your laptop:

```sh
ag doctor                 # this machine
ag status                 # machines, services, queues
ag                        # attach to the engine's sessions (tmux)
ag spawn "say hello and tell me which machine you're on"
open http://ag:7376       # AG Dash: the session should appear in Inbox
```

Then read the main [README](../README.md) for daily use, and [reference.md](reference.md) for each
component.

## Known gaps

- Several services Nathan uses won't work for you without their own credentials, and `ag setup` may warn
  about them: Telegram (`ag text`), iMessage (`ag messages`), Discord (`ag discord`), Nessie, and the
  arcade.school MCP servers. Ignore those warnings unless you want the feature.
- Linux service names are generic; the macOS LaunchAgents are named `com.nathan.*`. They work as-is.
- `ag infra` keeps its OpenTofu state on the Mac that ran it (`~/.local/state/ag-infra/`). Back it up.
