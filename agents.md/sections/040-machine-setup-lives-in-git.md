## Machine setup lives in git: ag and dotfiles (infrastructure as code)

Every change to the machine setup (any computer, phone, device, or service in the stack) must be captured in git in the same task, committed, pushed, and synced to **every machine** in `machines/README.md`, so any machine could be rebuilt from the two repos alone. Never leave hand edits outside them or commit secrets.

- **ag** (`~/ag`, private `koerschner/ag`): the agent system. Herdr and Pi config, AG Dash, the inbox, tickler, presence, the client ↔ host bridge, computer use, `op-*`, Tailscale, infra, LaunchAgents and systemd units, Hammerspoon's agent glue (`ag.lua`), these instructions (`agents.md/`), and the skills.
- **dotfiles** (public `koerschner/dotfiles`; checkout per machine in `machines/README.md`): personal machine config. Shell, editor, terminal, git, window management, Brewfile, macOS defaults, per-machine snapshots.

When in doubt, it goes in ag. **Load the `dotfiles-change` skill before making the change**: it has where things go, the sync steps, and the host/client model (read it before touching shortcuts, Herdr config, Hammerspoon, or anything that spans the host and a client).
