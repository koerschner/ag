# Ag session shortcuts (canonical)

One set of shortcuts on every device. The source of truth is
[`dot-config/ag/shortcuts.json`](dot-config/ag/shortcuts.json) (stowed to
`~/.config/ag/shortcuts.json`). Everything else follows it:

- **tmux** (`dot-config/ag/ag.tmux.conf`, Ag's server `tmux -L ag` on the session host)
  binds each shortcut as `prefix+<key>` (prefix `Ctrl+B`).
- **Mac clients** (Ghostty + Hammerspoon): Ghostty grabs Cmd keys itself, so
  Hammerspoon reads the spec and turns each Cmd key into `Ctrl+B` + key while an
  Ag window (title `ag: …`) is focused. Helper scripts run on the session host,
  so this works the same through `ag` (`ssh -t <host> ag-mux attach`).
- **iPhone/iPad** (Moshi): terminals don't send Cmd to tmux, so use the prefix
  chord (Moshi's shortcut panel or a hardware keyboard).
- **Anywhere**: `Ctrl+B`, then the key, always works.

<!-- BEGIN generated: ag-shortcuts-check --write -->
<!-- END generated -->

## Changing a shortcut

1. Edit `shortcuts.json`, then bind the prefix key in `ag.tmux.conf`.
2. Run `ag-shortcuts-check --write` (regenerates the table above).
3. Commit and sync (README: Keeping machines at parity). On the session host:
   `ag-mux server reload-config`; on each Mac client: `hs -c 'hs.reload()'`; then
   `ag-shortcuts-check` on both. `install` runs the check too.

`ag-shortcuts-check` fails if the running tmux bindings (on the session host), the
running Hammerspoon table (on a Mac), or this table has drifted from the spec.
