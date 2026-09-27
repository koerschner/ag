<!-- Herdr notes: everything agents need for working inside Herdr. Included into the global agent instructions under "Herdr (terminal multiplexer)"; edit here, then run agents.md/build. -->

Assume you are running inside Herdr, in an existing pane of an existing workspace. Confirm with `test "$HERDR_ENV" = 1`; your location is `$HERDR_WORKSPACE_ID` / `$HERDR_TAB_ID` / `$HERDR_PANE_ID`. Herdr is not tmux: `$TMUX` is unset and tmux commands do not apply.

Hard rules:
- Never run bare `herdr` (launches the TUI; nested launches are blocked). Never run `herdr server stop`, `herdr session stop`, or `herdr update`.
- Never probe a mutating command by omitting args — `herdr workspace create` with no flags *executes*. Use `<cmd> --help`.
- Commands return JSON; IDs and state live under `.result`. Parse them, never guess from sidebar order. Errors are JSON on stderr, exit 1 (exit 2 = syntax).
- `herdr --skill` prints the full, authoritative agent skill for the installed version; `herdr <group>` prints that group's command list. Consult them when something below doesn't match.

# Mental model

- **Workspace** (`w3`) → **tab** (`w3:t8`) → **pane** (`w3:p4`). Workspaces are organized by topic (Economy, Social, …), not per worktree. IDs are stable and never reused; a pane moved to another workspace gets a new ID (`.result.move_result.pane.pane_id`).
- **Pane commands** control raw terminals (shells, servers, tests). **Agent commands** control a recognized coding agent occupying a pane, with lifecycle states `idle` / `working` / `blocked` / `done` / `unknown`. `idle` and `done` both mean ready for input; `blocked` = approval/question dialog showing; `unknown` = present but unclassified (does not mean finished).
- Agent targets are a unique live agent name (`[a-z][a-z0-9_-]{0,31}`) or the pane ID hosting it — never a terminal ID or a bare kind like `pi`.
- Prefer `--current` to target your own pane. Never rely on the UI-focused pane; it may belong to the user or another client.

Spatial language refers to the Herdr layout:
- "here" = the current pane (`herdr pane current --current`).
- "above/below/left/right" = the neighboring pane in that direction in the current tab (`herdr pane neighbor --current --direction up|down|left|right`).
- "tab" = a new tab in the current workspace, not a new workspace or session.
- "workspace" = a Herdr workspace (a topic area), not a session.
- "space" = the current Herdr workspace (`$HERDR_WORKSPACE_ID`), e.g. "all my agents in this space" = every agent in this workspace's tabs (excluding yourself).

# Seeing what's in motion (tmux `capture-pane` equivalent)

Reading works on any pane in any workspace, not just your own. Use it to orient when the user references work happening elsewhere ("the dev server", "the other agent", "what's failing over there").

```bash
herdr workspace list                                  # labels, IDs, agent_status, tab/pane counts
herdr tab list --workspace <ws>                       # tabs + labels in a workspace
herdr pane list [--workspace <ws>]                    # every pane: pane_id, tab_id, cwd, terminal_title,
                                                      #   agent, agent_status, agent_session.value (Pi .jsonl path)
herdr agent list                                      # only panes hosting recognized agents, with names/states
herdr pane get <pane-id> | herdr agent get <target>   # one pane / one agent in detail
herdr pane process-info --pane <pane-id>              # foreground process argv, pgid
herdr pane layout --pane <pane-id>                    # geometry (use before deciding split direction)
herdr pane read <pane-id> --source recent-unwrapped --lines 200   # scrollback + viewport
herdr agent read <target> --source recent-unwrapped --lines 200   # same, via agent surface
herdr pane wait-output <pane-id> --match <text> | --regex <re> [--timeout <ms>]   # block until it appears
herdr agent wait <target> [--until idle|done|blocked] [--timeout <ms>]           # block on lifecycle state
herdr agent explain <target>                          # why Herdr classified the agent's state as it did
herdr api snapshot                                    # whole live session state as one JSON blob
```

Read sources: `visible` (rendered screen only), `recent` (with soft wraps), `recent-unwrapped` (wraps joined — default choice for logs/transcripts), `detection` (plain-text buffer Herdr uses for agent detection). Add `--format ansi` only when color is evidence. If a large read still doesn't show a completed agent response, ask that agent to write it to a temp Markdown file and reply with the path; read the file.

Reading is safe anywhere. Only send input (`pane send-text`, `pane send-keys`, `pane run`, `agent prompt`, `agent send-keys`) to panes you created or the user explicitly pointed you at — other panes may be another agent mid-task. Never answer another agent's `blocked` dialog without asking the user.

# Creating layout

```bash
herdr pane split --current --direction right|down --cwd "$PWD" [--ratio 0.5] --no-focus   # → .result.pane.pane_id
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label <name> --cwd <dir> --no-focus   # → .result.tab, .result.root_pane
herdr workspace create --cwd <dir> --label <name> --no-focus                                # → .result.workspace/.tab/.root_pane (only when asked)
herdr worktree open   --cwd ~/<repo> (--path <p> | --branch <b>) --no-focus   # only when Nathan asks
herdr pane rename <pane-id> <name>   |  herdr tab rename <tab-id> <name>  |  herdr workspace rename <ws> <name>
herdr pane zoom / resize / swap / move / focus / close    (see --help)
herdr pane close <pane-id>  |  herdr tab close <tab-id>   # only things you created
```

Split direction: check `herdr pane layout --pane "$HERDR_PANE_ID"`; split wide panes `right`, narrow/tall ones `down`; avoid stacking same-direction splits into slivers. Always `--no-focus` so the user's focus stays put. `--trust-repository` on worktree commands only after the user has vetted the repo — not a retry flag.

# Running commands in panes

```bash
herdr pane run <pane-id> "<cmd>"                      # sends text + Enter atomically
herdr pane send-text <pane-id> "<text>"               # literal text, no Enter
herdr pane send-keys <pane-id> enter|esc|ctrl+c|...   # logical keys, validated before write
herdr pane wait-output <pane-id> --match "ready" --timeout 120000
herdr pane read <pane-id> --source recent-unwrapped --lines 120
```

`wait-output` matches output that already exists too — including the echoed command line itself. So `pane run <id> 'cmd; echo DONE'` + `--match DONE` returns immediately. Use a sentinel that only appears on completion and anchor it: `pane run <id> 'cmd; echo PROBE_DONE'` then `wait-output <id> --regex '^PROBE_DONE$'`. Omit `--timeout` for indefinite.

For dev processes (apps, servers, watchers):
- Never create a new session or workspace unless explicitly asked. Work inside the current workspace.
- Start each task in a new tab with a descriptive label, or split beside yourself for something short-lived.
- Group related processes as panes within one tab rather than spreading across tabs.
- Tell the user which tab and panes things are running in (label and IDs).

# Starting and driving another agent

Only when the user asks for delegation/parallel agents — not merely because a task could benefit from it.

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus              # need a pane at a bare shell prompt
herdr agent start <name> --kind pi|claude|codex|gemini|... --pane <pane-id> [--timeout 30000] [-- <agent-args>]
herdr agent prompt <name> "<text>" --wait --timeout 120000    # submits; waits for first settled idle/done/blocked
herdr agent wait <name> --until blocked --timeout 120000      # only for state-specific waits
herdr agent read <name> --source recent-unwrapped --lines 120
herdr agent send-keys <name> esc | ctrl+c | enter
herdr agent get <name>  |  herdr agent explain <name>
herdr agent rename <target> <name>|--clear  |  herdr agent focus <target>
```

- `agent start` needs an *existing* pane at an interactive prompt; it never creates layout. It returns once the agent is detected and ready (or `agent_not_ready` if blocked during startup — name still usable for read/send-keys).
- `agent prompt` refuses with `agent_blocked` if a dialog is up; inspect via `agent read`, ask the user before answering it.
- `--wait` returns `agent_prompt_stalled` if no `working`/`blocked` activity within ~5s, or `timeout`. Neither proves the prompt wasn't delivered — read the pane before resending.
- Pane-level `send-text`/`run` on an agent pane is raw terminal control; use the agent surface unless raw control is intentional.

# Other

- `herdr notification show "<title>" [--body TEXT] [--sound done|request]` — surface a toast to the user (e.g. long job finished).
- `herdr status` — client/server versions (check before relying on a new feature; a missing method is not a reason to restart/upgrade).
- `herdr --machine <label> <cmd>` — run any of the above against a saved SSH machine; discover IDs there, don't reuse local ones. `herdr machine list` shows profiles only. Don't add/remove profiles unless asked.
- `herdr session ...` — named persistent servers; leave alone unless asked.
- `herdr api schema` — full socket API schema if a CLI flag is missing.

# Helper sessions and links

- **Spin-outs go to the Inbox.** Whenever you spin out a new inquiry or side session in its own tab (a separate topic, a follow-up for Nathan to pick up, a helper pi session), open it as a new tab in the Herdr **Inbox** workspace, unless Nathan says where else. Easiest: POST one self-contained prompt to the ag inbox (`curl -sS --data-binary @prompt.md http://ag:7373/prompt`); it names the tab, opens it in Inbox without taking focus, starts pi, and sends the prompt. For a tab you need to drive yourself, find Inbox by label (`herdr workspace list`, `.label == "Inbox"`), `herdr tab create --workspace <id> --label <name> --cwd <dir> --no-focus`, then `herdr agent start`. The Inbox auto-filer treats a session's second prompt as Nathan's first reply and moves it to a topic workspace, so a spin-out should get everything in its first prompt. Link the new tab for Nathan with `herdr-link`. Short-lived panes split beside you stay in your own tab.
- **Use other sessions freely.** You may start extra pi sessions (new tabs in the Inbox per the rule above, or panes beside you) to parallelize a task: independent investigations, long checks, a second machine's side of a change. Give each a clear self-contained prompt, keep them off files you're editing, read their results back, and close the tabs you created when done. Nathan's standing permission; don't ask first. Never drive sessions you didn't create unless he points you at them.
- **Link to other sessions.** Whenever you mention another Herdr tab (related work, where something is running, a session Nathan should look at), include a clickable link from `herdr-link <tab_id>` or `herdr-link --grep <label regex>`. It prints `Workspace › Tab  gemini://<host>/focus/<tab_id>`; Cmd+click in Ghostty switches his attached Herdr straight to that tab (via `HerdrLink.app` → Hammerspoon; no browser). Put the URL on its own line, bare (no markdown link syntax): Herdr strips OSC 8 hyperlinks, and Ghostty only auto-links a fixed set of schemes. Fallback if HerdrLink isn't installed on a client: `http://<host>:7374/focus?tab=<id>` (opens a browser first).
- **Testing clicks.** CUA is blocked from controlling Ghostty, and synthetic Cmd+clicks don't trigger Ghostty's link hover, so a real click can only be verified by Nathan. Verify everything after the click by opening the URL directly on the client (`ssh <client> open '<url>'`) and checking `focused_tab_id` in `herdr api snapshot`; restore his previous focus afterwards.
