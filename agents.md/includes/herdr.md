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

# Working with panes and agents

Run `herdr --skill` for the full command reference of the installed version (reading panes, layout, running commands, starting and driving agents, waits); `herdr <group>` lists a group's commands. The rules that matter every time:

- **Reading is safe anywhere.** `herdr workspace list`, `herdr tab list --workspace <ws>`, `herdr pane list`, `herdr agent list`, and `herdr pane read <pane> --source recent-unwrapped --lines 200` work on any pane; use them to orient when Nathan refers to work elsewhere ("the dev server", "the other agent").
- **Only send input** (`pane run`/`send-text`/`send-keys`, `agent prompt`/`send-keys`) to panes you created or Nathan pointed you at. Never answer another agent's `blocked` dialog without asking him.
- **Dev processes** (apps, servers, watchers): start each in a new tab with a descriptive label in the current workspace (or split beside yourself for something short-lived), group related processes as panes in one tab, always pass `--no-focus`, and tell Nathan the tab/pane labels and IDs. Never create a new session or workspace unless asked; close only things you created.
- **`pane wait-output` also matches output that already exists**, including the echoed command line. Use an anchored sentinel that only appears on completion (`echo PROBE_DONE` + `--regex '^PROBE_DONE$'`).
- **Delegating to another agent** only when Nathan asks (see "Use other sessions freely" below for his standing permission): `agent start` needs an existing pane at a shell prompt; `agent prompt --wait` returning `agent_prompt_stalled` or `timeout` doesn't prove the prompt wasn't delivered, so read the pane before resending.
- `herdr notification show "<title>" [--body TEXT] [--sound done|request]` surfaces a toast to Nathan. Leave `herdr session …` and machine profiles alone unless asked; a missing method is not a reason to restart or upgrade.

# Helper sessions and links

- **Spin-outs go to the Inbox.** Whenever you spin out a new inquiry or side session in its own tab (a separate topic, a follow-up for Nathan to pick up, a helper pi session), open it as a new tab in the Herdr **Inbox** workspace, unless Nathan says where else. Easiest: POST one self-contained prompt to the ag inbox (`curl -sS -H 'content-type: text/plain' --data-binary @prompt.md 'http://ag:7373/prompt?new=1'`; without the text/plain header curl sends a form body and the inbox rejects it as `empty`, and `new=1` stops it from being routed into an existing session); it names the tab, opens it in Inbox without taking focus, starts pi, and sends the prompt. For a tab you need to drive yourself, find Inbox by label (`herdr workspace list`, `.label == "Inbox"`), `herdr tab create --workspace <id> --label <name> --cwd <dir> --no-focus`, then `herdr agent start`. The Inbox auto-filer treats a session's second prompt as Nathan's first reply and moves it to a topic workspace, so a spin-out should get everything in its first prompt. Link the new tab for Nathan with `herdr-link`. Short-lived panes split beside you stay in your own tab.
- **Use other sessions freely.** You may start extra pi sessions (new tabs in the Inbox per the rule above, or panes beside you) to parallelize a task: independent investigations, long checks, a second machine's side of a change. Give each a clear self-contained prompt, keep them off files you're editing, read their results back, and close the tabs you created when done. Nathan's standing permission; don't ask first. Never drive sessions you didn't create unless he points you at them.
- **Link to other sessions.** Whenever you mention another Herdr tab (related work, where something is running, a session Nathan should look at), include a clickable link from `herdr-link <tab_id>` or `herdr-link --grep <label regex>`. It prints `Workspace › Tab  gemini://<host>/focus/<tab_id>`; Cmd+click in Ghostty switches his attached Herdr straight to that tab (via `HerdrLink.app` → Hammerspoon; no browser). Put the URL on its own line, bare (no markdown link syntax): Herdr strips OSC 8 hyperlinks, and Ghostty only auto-links a fixed set of schemes. Fallback if HerdrLink isn't installed on a client: `http://<host>:7374/focus?tab=<id>` (opens a browser first).
- **Testing clicks.** CUA is blocked from controlling Ghostty, and synthetic Cmd+clicks don't trigger Ghostty's link hover, so a real click can only be verified by Nathan. Verify everything after the click by opening the URL directly on the client (`ssh <client> open '<url>'`) and checking `focused_tab_id` in `herdr api snapshot`; restore his previous focus afterwards.
