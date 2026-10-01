---
name: dotfiles-change
description: Make any machine-setup change the IaC way, in the ag repo (agent system) or dotfiles (personal config) - scripts, configs, LaunchAgents, shortcuts, Hammerspoon, Herdr keybindings, stow packages, new machines - and sync it to every machine. Use before touching ag, dotfiles, or anything outside a repo on ag-mac or a client, and whenever changing keyboard shortcuts or the host/client setup.
---

# Changing the machine setup (ag + dotfiles)

The rule (always-on, in the global instructions): every machine change lives in git (the ag repo or dotfiles), is committed and pushed in the same task, and is synced to every machine. This skill is the how.

## What goes where

Every change to the machine setup (any computer, phone, device, or service in the stack) must be fully captured in git in the same task, and committed and pushed. Two repos, both stowed into `~` on every machine:

- **ag** (`~/ag` everywhere; public `koerschner/ag`): the agent system. Herdr and Pi config, AG Dash, ag-inbox, tickler, presence, the bridge (`show`, `shot`, `mac`, `client-cua`), `op-*`, Tailscale, `infra/`, LaunchAgents (`macos-launchagents/`), systemd units, `macos-apps/`, Hammerspoon's agent glue (`hammerspoon/dot-hammerspoon/ag.lua`), `agents.md/`, the skills, `claude/` and `codex/`, and `machines/README.md` (the inventory). Installed by `ag setup` (runs `./install` on a Mac, `./bootstrap-linux` on Linux); `ag doctor` checks a machine.
- **dotfiles** (public `koerschner/dotfiles`): personal machine config. zsh, nvim, ghostty, git, tmux, ssh, mise, alfred, Hammerspoon's `init.lua`/window management, `Brewfile`, `macos` defaults, `snapshot` and `machines/<host>/` snapshots. Its `bootstrap` clones ag and runs `~/ag/install`.

When in doubt, it goes in ag. `machines/README.md` (in ag) lists every machine with its role, SSH alias, user, home, and both checkout paths (dotfiles: ag-mac has `~/dotfiles-seen-setup`, others `~/dotfiles`). The bar: if any device or part of the system were replaced, or a new one added, it could be built from zero using only the two repos (`bootstrap` + `install` + READMEs + the secrets checklist). Concretely:

- Scripts go in `bin/dot-local/bin` of the right repo, LaunchAgents in ag's `macos-launchagents/`, configs in a stow package (add new packages to `STOW_PACKAGES` in ag's `install` or dotfiles' `bootstrap`, and to `bootstrap-linux` if they apply on Linux).
- Settings that can't be stowed (app preferences, iOS Shortcuts, GUI-only toggles) get documented in the README or a doc in the repo, precise enough to recreate. Examples: the CleanShot export path; iOS Shortcuts in `ios-shortcuts/`, as a mermaid flowchart plus build steps.
- Secrets are never committed; list any new one in the bootstrap secrets checklist and README.
- Every push ends with syncing **every machine in the inventory**; a push isn't finished until all of them have it. Run **`ag sync`** (or `ag sync ag` / `ag sync dotfiles`) from the session host after committing your files: it rebuilds AGENTS.md (committing it alone if only the generated file was stale), lists uncommitted files (it never commits them), pulls `--rebase` and pushes to `main`, then on every machine (in parallel) runs `git pull --ff-only`, restows every stow package of that repo for the machine's OS, reloads Hammerspoon if `hammerspoon/` changed, and re-runs `install` / `bootstrap-linux` / `bootstrap` when they (or LaunchAgents / systemd units) changed. It names unreachable machines (e.g. a sleeping client): sync those later with `ag sync --only <alias>`, or schedule a tickler `check` on `ssh -o ConnectTimeout=5 <alias> true` that runs it. Still reload or kickstart any changed LaunchAgent or service yourself (`ag restart <service>`), and verify it works on each machine. By hand, the same steps per machine are: `git pull --ff-only` in the checkout, `stow --dotfiles --no-folding -d <checkout> -t ~ -R <pkg>` (full path `/opt/homebrew/bin/stow` over non-interactive SSH), `hs -c 'hs.reload()'`.
- When a machine joins, leaves, or changes role, update ag's `machines/README.md`, dotfiles' `ssh/dot-ssh/config`, and any role-specific defaults in the same change.
- Don't leave hand edits outside the repo.

## Commit policy

Both repos are fully slop-cannon: commit only the files you changed and push to `main` without asking (`git pull --rebase --autostash origin main` first; ag-mac's dotfiles checkout is on a local branch, so push that one with `git push origin HEAD:main`). The pre-commit hook rejects a stale generated AGENTS.md: run `agents.md/build` and stage both (`ag sync` also rebuilds it). Leave other uncommitted changes alone; another session may own them.

## Host/client model (read before changing shortcuts, Herdr, or dotfiles)

The setup is a host/client system. Setup mistakes have come from reasoning about one machine when the behavior spans two. Think in roles, not machine names. `machines/README.md` maps roles to machines (today: host `ag-mac`, client `ag-client`; `ag-engine` is joining); everything below applies to whichever machine holds a role.

**Roles.**
- **Host:** runs the Herdr server, the agents, and the repos. All session state lives here, and every script that acts on Herdr must run here.
- **Client:** where Nathan sits. It runs no Herdr server. It attaches to the host with the `ag` command (`bin/dot-local/bin/ag` = `herdr --remote <host> --remote-keybindings server`), and runs the desktop side: Hammerspoon, Ghostty, Jump Desktop, CleanShot, and the bridge helpers.
- A key press travels client keyboard → client Hammerspoon → client Ghostty → herdr client → SSH → host Herdr server. Anything that *executes* on the client (a Hammerspoon task, a local script) runs where there is no Herdr session, and fails quietly.

**Shortcut rules.**
- The client only translates keys. Hammerspoon turns Cmd shortcuts into Herdr prefix chords (`herdrShortcuts` in ag's `hammerspoon/dot-hammerspoon/ag.lua`); it never runs Herdr scripts or SSH.
- The host executes. Any shortcut that runs a script is a Herdr `[[keys.command]]` in `herdr/dot-config/herdr/config.toml`, so the host's Herdr server runs it. Herdr drops client-side custom-command bindings over `--remote`; that's why `ag` uses the host's keybindings.
- The chord must survive the terminal unchanged. Ghostty rewrites some keys before Herdr sees them (e.g. `alt+arrow` becomes `esc b`/`esc f`; check with `ghostty +list-keybinds --default`). Prefer `prefix+<plain key or punctuation>`, and check that `herdr server reload-config` reports no diagnostics.
- Current map: Cmd+W/D/Shift+D/1–9 → built-in Herdr actions; Cmd+T → `prefix+t` (new pi tab); Cmd+[ / ] → `prefix+[` / `prefix+]` (herdr-nav back/forward); prefix+f find tab (fuzzy over space/tab names and contents); prefix+Shift+L last space.
- The same chords work when Nathan uses Herdr directly on the host, since host and client share this config.

**Portability (both repos).**
- Usernames and homes differ per machine (see the inventory). Never commit an absolute home path or username. Use `$HOME`/`~`, or `sh -c '... "$HOME/..."'` where a tool doesn't expand them (pi's `mcp.json`).
- Tracked configs must be symlinks into the checkout on every machine, never edited copies. A copy stops receiving updates without any error. Settings that only one machine needs go in an untracked include (e.g. `~/.config/ghostty/local.conf`) and are documented in the README.
- Only known per-machine copy: `~/.codex/config.toml` (the Codex app rewrites it). A machine can hold an old retired checkout (ag-mac has `~/dotfiles`); nothing current should link into it. Everything agent-related links into `~/ag`, nothing into a dotfiles checkout.

**Verify on the real path.** Unit-testing a script, or synthesizing keys past Ghostty, is not proof. Send the actual Cmd shortcut or prefix chord into the focused Ghostty Herdr window (e.g. `hs.eventtap.keyStroke` after `hs.application.find("Ghostty"):activate(true)`), then confirm the effect on the host with `herdr api snapshot` or `herdr tab list`. Close any test tabs. To test the client path, do the same on the client over `ssh <client>` with `/opt/homebrew/bin/hs`. After a Herdr config change on the host, `herdr server reload-config` updates attached clients live. Reattaching (prefix+d, then `ag`) is only needed when the `ag` command changed. To audit links on a machine, compare every `git ls-files <pkg>` entry to its `$HOME` target; each should be a symlink that resolves into that machine's checkout.
