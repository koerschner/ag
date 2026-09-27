# Herdr shortcuts (canonical)

One set of shortcuts on every device. The source of truth is
[`dot-config/herdr/shortcuts.json`](dot-config/herdr/shortcuts.json) (stowed to
`~/.config/herdr/shortcuts.json`). Everything else follows it:

- **Herdr** (`dot-config/herdr/config.toml`) binds each shortcut twice: the Cmd key
  directly, for terminals that forward Cmd (Moshi), and `prefix+<key>`.
- **Mac clients** (Ghostty + Hammerspoon; the client Mac, and ag's own desktop
  through Jump Desktop): Ghostty grabs Cmd keys itself, so Hammerspoon reads the
  spec and turns each Cmd key into `Ctrl+B` + key while a Herdr window is focused.
  This works the same through `ag` (`herdr --remote`), since helper scripts run
  on the server.
- **iPhone/iPad** (Moshi with a hardware keyboard): Moshi forwards Cmd keys to
  Herdr, except for the ones it keeps for itself (Cmd+N/W/O/K/V/1–9). Use the
  prefix for those.
- **Anywhere**: `Ctrl+B`, then the key, always works.

<!-- BEGIN generated: herdr-shortcuts-check --write -->
| Shortcut | Action | Mac (Ghostty) | iPhone/iPad (Moshi) | Prefix fallback |
|---|---|---|---|---|
| Cmd+T | New tab running Pi | Hammerspoon → prefix chord | direct (verified) | `Ctrl+B` `t` |
| Cmd+W | Close pane | Hammerspoon → prefix chord | Moshi keeps it: `Ctrl+B` `x` | `Ctrl+B` `x` |
| Cmd+Shift+T | Reopen closed pane | Hammerspoon → prefix chord | direct | `Ctrl+B` `u` |
| Cmd+D | Split side by side | Hammerspoon → prefix chord | direct | `Ctrl+B` `v` |
| Cmd+Shift+D | Split stacked | Hammerspoon → prefix chord | direct | `Ctrl+B` `-` |
| Cmd+[ | Focus history back | Hammerspoon → prefix chord | direct | `Ctrl+B` `[` |
| Cmd+] | Focus history forward | Hammerspoon → prefix chord | direct | `Ctrl+B` `]` |
| Cmd+1–9 | Switch to tab 1-9 | Hammerspoon → prefix chord | Moshi keeps it: `Ctrl+B` `1–9` | `Ctrl+B` `1–9` |
<!-- END generated -->

## Changing a shortcut

1. Edit `shortcuts.json`, then bind both keys in `config.toml`.
2. Run `herdr-shortcuts-check --write` (regenerates the table above).
3. Commit, sync both Macs (README: Keeping machines at parity). On each Mac:
   `herdr server reload-config` if it runs the Herdr server, `hs -c 'hs.reload()'`,
   then `herdr-shortcuts-check`. `bootstrap` runs the check too.

`herdr-shortcuts-check` fails if Herdr's config, the running Hammerspoon table,
or this table has drifted from the spec.
