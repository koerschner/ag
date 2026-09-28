## Multi-machine setup model: host and client (read before changing shortcuts, Herdr, or dotfiles)

The setup is a host/client system. Setup mistakes have come from reasoning about one machine when the behavior spans two. Think in roles, not machine names. `machines/README.md` maps roles to machines (today: host `ag`, client `nathan-dev-client`); everything below applies to whichever machine holds a role.

**Roles.**
- **Host:** runs the Herdr server, the agents, and the repos. All session state lives here, and every script that acts on Herdr must run here.
- **Client:** where Nathan sits. It runs no Herdr server. It attaches to the host with the `ag` command (`bin/dot-local/bin/ag` = `herdr --remote <host> --remote-keybindings server`), and runs the desktop side: Hammerspoon, Ghostty, Jump Desktop, CleanShot, and the bridge helpers.
- A key press travels client keyboard → client Hammerspoon → client Ghostty → herdr client → SSH → host Herdr server. Anything that *executes* on the client (a Hammerspoon task, a local script) runs where there is no Herdr session, and fails quietly.

**Shortcut rules.**
- The client only translates keys. Hammerspoon turns Cmd shortcuts into Herdr prefix chords (`herdrShortcuts` in `hammerspoon/dot-hammerspoon/init.lua`); it never runs Herdr scripts or SSH.
- The host executes. Any shortcut that runs a script is a Herdr `[[keys.command]]` in `herdr/dot-config/herdr/config.toml`, so the host's Herdr server runs it. Herdr drops client-side custom-command bindings over `--remote`; that's why `ag` uses the host's keybindings.
- The chord must survive the terminal unchanged. Ghostty rewrites some keys before Herdr sees them (e.g. `alt+arrow` becomes `esc b`/`esc f`; check with `ghostty +list-keybinds --default`). Prefer `prefix+<plain key or punctuation>`, and check that `herdr server reload-config` reports no diagnostics.
- Current map: Cmd+W/D/Shift+D/1–9 → built-in Herdr actions; Cmd+T → `prefix+t` (new pi tab); Cmd+[ / ] → `prefix+[` / `prefix+]` (herdr-nav back/forward); prefix+f find tab (fuzzy over space/tab names and contents); prefix+Shift+L last space.
- The same chords work when Nathan uses Herdr directly on the host, since host and client share this config.

**Dotfiles portability.**
- Usernames and homes differ per machine (see the inventory). Never commit an absolute home path or username. Use `$HOME`/`~`, or `sh -c '... "$HOME/..."'` where a tool doesn't expand them (pi's `mcp.json`).
- Tracked configs must be symlinks into the checkout on every machine, never edited copies. A copy stops receiving updates without any error. Settings that only one machine needs go in an untracked include (e.g. `~/.config/ghostty/local.conf`) and are documented in the README.
- Only known per-machine copy: `~/.codex/config.toml` (the Codex app rewrites it). A machine can hold an old retired checkout (ag has `~/dotfiles`); nothing current should link into it.

**Verify on the real path.** Unit-testing a script, or synthesizing keys past Ghostty, is not proof. Send the actual Cmd shortcut or prefix chord into the focused Ghostty Herdr window (e.g. `hs.eventtap.keyStroke` after `hs.application.find("Ghostty"):activate(true)`), then confirm the effect on the host with `herdr api snapshot` or `herdr tab list`. Close any test tabs. To test the client path, do the same on the client over `ssh <client>` with `/opt/homebrew/bin/hs`. After a Herdr config change on the host, `herdr server reload-config` updates attached clients live. Reattaching (prefix+d, then `ag`) is only needed when the `ag` command changed. To audit links on a machine, compare every `git ls-files <pkg>` entry to its `$HOME` target; each should be a symlink that resolves into that machine's checkout.
