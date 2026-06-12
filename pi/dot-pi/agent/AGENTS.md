## tmux

Always assume you are running inside tmux, in an existing session and window. Use `$TMUX_PANE` / `tmux display-message` to discover the current session, window, and pane when needed.

Spatial language refers to this tmux layout:
- "here" means the current pane — the one the agent was started in, including its scrollback/output from before the agent started (inspect with `tmux capture-pane -p -t <pane> -S -<lines>`).
- "above", "below", "left", "right" mean the neighboring pane in that direction within the current window (e.g. `tmux select-pane -t '{up-of}'` or target via `tmux display-message -t '{up-of}' ...`).
- "window" means a new window in the current session, not a new session.

When running development processes (apps, dev servers, watchers):
- Never create a new tmux session unless explicitly asked. Work inside the current session.
- Start each task in a new window in the current session, with a descriptive window name.
- If a task involves multiple related processes/services, group them as panes within that one new window rather than spreading them across windows.
- Tell the user which window (and panes) things are running in, e.g. `tmux select-window -t <session>:<window-name>`.

Never create a git commit without consulting the user first and receiving explicit approval.
