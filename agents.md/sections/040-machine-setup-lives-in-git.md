## Machine setup lives in git: ag and dotfiles (infrastructure as code)

Every change to the machine setup (any computer, phone, device, or service in the stack) must be captured in git in the same task, committed, pushed, and synced to **every machine** in `machines/README.md`, so any machine could be rebuilt from the two repos alone. Never leave hand edits outside them or commit secrets.

- **ag** (`~/ag`, public `<owner>/ag`): the agent system. tmux (ag-mux) and Pi config, ag-dash, the inbox, ag-tickler, ag-presence, the client ↔ host bridge, computer use, `op-*`, Tailscale, infra, LaunchAgents and systemd units, Hammerspoon's agent glue (`ag.lua`), these instructions (`agents.md/`), and the skills.
- **dotfiles** (your public dotfiles repo; checkout per machine in `machines/README.md`): personal machine config. Shell, editor, terminal, git, window management, Brewfile, macOS defaults, per-machine snapshots.

- **ag-personal** (your private personal repo, `~/ag-personal`): the user's personal layer. `AGENTS.md` (linked as `~/AGENTS.md` and `~/CLAUDE.md`, so every agent under the home directory loads it) and `env` (private values public scripts read, e.g. `AG_TEXT_NUMBER`). Sync with `ag sync personal`.

**ag and dotfiles are public: nothing personal goes in them.** No addresses, phone numbers, emails, cards, vault IDs, IPs or the tailnet name, teammates' or students' details, employer-internal specifics, or real session content (fixtures included). Write them generically and put the specifics in ag-personal. Check the diff before committing.

When in doubt, it goes in ag. **Load the `dotfiles-change` skill before making the change**: it has where things go, the sync steps, and the host/client model (read it before touching shortcuts, the tmux config, Hammerspoon, or anything that spans the host and a client).
