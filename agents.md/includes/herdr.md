<!-- Herdr notes: everything agents need for working inside Herdr. Included into the global agent instructions under "Herdr (terminal multiplexer)"; edit here, then run agents.md/build. -->

Assume you are running inside Ag's session layer, in an existing pane of an existing workspace: Herdr today, or tmux with `agd` on ag-engine (`$AG_MUX` = 1). Confirm with `test "$HERDR_ENV" = 1`; find your own workspace, tab, pane and link with `ag me` (the `$HERDR_*` ids go stale when a tab is filed). Drive it with **`ag-mux`**: the same CLI as Herdr's, sent to whichever backend this host runs (`ag-mux backend`), so use `ag-mux …` everywhere below rather than `herdr …` (docs/tmux-port.md in ag).

Hard rules:
- Never run bare `ag-mux`/`herdr` or `tmux attach` from a pane (they attach a terminal UI). Never run `herdr server stop`, `herdr session stop`, `herdr update`, or `tmux -L ag kill-server`.
- Never probe a mutating command by omitting args — `ag-mux workspace create` with no flags *executes*.
- Commands return JSON; IDs and state live under `.result`. Parse them, never guess from sidebar order. Errors are JSON on stderr, exit 1 (exit 2 = syntax).
- `ag-mux --skill` (tmux) or `herdr --skill` (Herdr) prints the agent skill; `herdr <group>` lists a group's commands.

# Mental model

- **Workspace** (`w3`) → **tab** (`w3:t8`) → **pane** (`w3:p4`). Workspaces are organized by topic (Economy, Social, …), not per worktree. IDs are stable and never reused. Under Herdr a pane moved to another workspace gets a new ID (`.result.move_result.pane.pane_id`); under tmux it keeps it.
- **Pane commands** control raw terminals (shells, servers, tests). **Agent commands** control a recognized coding agent occupying a pane, with lifecycle states `idle` / `working` / `blocked` / `done` / `unknown`. `idle` and `done` both mean ready for input; `blocked` = approval/question dialog showing; `unknown` = present but unclassified (does not mean finished).
- Agent targets are a unique live agent name (`[a-z][a-z0-9_-]{0,31}`) or the pane ID hosting it — never a terminal ID or a bare kind like `pi`.
- Prefer `--current` to target your own pane. Never rely on the UI-focused pane; it may belong to the user or another client.

Spatial language refers to the Herdr layout:
- "here" = the current pane (`ag-mux pane current --current`).
- "above/below/left/right" = the neighboring pane in that direction in the current tab (`ag-mux pane neighbor --current --direction up|down|left|right`).
- "tab" = a new tab in the current workspace, not a new workspace or session.
- "workspace" = a Herdr workspace (a topic area), not a session.
- "space" = the current Herdr workspace (`$HERDR_WORKSPACE_ID`), e.g. "all my agents in this space" = every agent in this workspace's tabs (excluding yourself).

# The `ag` CLI first

For anything at the session level, use `ag <verb>` (`ag help` lists them; `ag <verb> --help` for details) instead of hand-rolled `ag-mux … | jq`, curl to AG Dash or the inbox, or `jq` over `.jsonl` files. Every session argument takes a session id (or a unique prefix/suffix), a tab or pane id, an AG Dash link, or a label match, resolved fresh on each call (so no stale pane ids); the default is your own session. `--json` where machine output helps.

- Find and read: `ag me`, `ag ls [workspace] [--hot|--waiting|--needs-you]`, `ag find <words>` (open, hibernated and closed sessions), `ag peek <s>` (its screen), `ag read <s> [--user|--assistant] [--last N]` (its transcript), `ag link [s] [--phone]`.
- Act: `ag send <s> "msg" [--interrupt]`, `ag spawn "prompt"`, `ag report "msg"`, `ag merge <A…>`, `ag close [s]`, `ag rename "label" [s]`, `ag file <workspace> [s]`, `ag hot [on|off] [s]`, `ag wait [s]` / `ag unwait [s]`, `ag resume <s>`.
- System: `ag sync [ag|dotfiles]`, `ag status`, `ag logs <service> [-f]`, `ag restart <service>`; this machine: `ag setup` (install or update Ag here), `ag doctor` (what it still lacks).

# Working with panes and agents

Run `ag-mux --skill` / `herdr --skill` for the full command reference of the installed version (reading panes, layout, running commands, starting and driving agents, waits); `herdr <group>` lists a group's commands. The rules that matter every time:

- **Reading is safe anywhere.** `ag ls`, `ag peek`, `ag read`, `ag find`, and raw `ag-mux workspace list`, `ag-mux tab list --workspace <ws>`, `ag-mux pane list`, `ag-mux agent list`, and `ag-mux pane read <pane> --source recent-unwrapped --lines 200` work on any pane; use them to orient when Nathan refers to work elsewhere ("the dev server", "the other agent").
- **Only send input** (`pane run`/`send-text`/`send-keys`, `agent prompt`/`send-keys`) to panes you created or Nathan pointed you at. Never answer another agent's `blocked` dialog without asking him.
- **Dev processes** (apps, servers, watchers): start each in a new tab with a descriptive label in the current workspace (or split beside yourself for something short-lived), group related processes as panes in one tab, always pass `--no-focus`, and tell Nathan the tab/pane labels and IDs. Never create a new session or workspace unless asked; close only things you created.
- **`pane wait-output` also matches output that already exists**, including the echoed command line. Use an anchored sentinel that only appears on completion (`echo PROBE_DONE` + `--regex '^PROBE_DONE$'`).
- **Delegating to another agent** only when Nathan asks (see "Use other sessions freely" below for his standing permission): `agent start` needs an existing pane at a shell prompt; `agent prompt --wait` returning `agent_prompt_stalled` or `timeout` doesn't prove the prompt wasn't delivered, so read the pane before resending.
- `ag-mux notification show "<title>" [--body TEXT] [--sound done|request]` surfaces a toast to Nathan. Leave `herdr session …` and machine profiles alone unless asked; a missing method is not a reason to restart or upgrade.

# Helper sessions and links

- **Spin-outs go to the Inbox.** Whenever you spin out a new inquiry or side session in its own tab (a separate topic, a follow-up for Nathan to pick up, a helper pi session), open it as a new tab in the **Inbox** workspace, unless Nathan says where else: `ag spawn "<self-contained prompt>"` (or `-f prompt.md`, or stdin). It goes through the ag inbox, which names the tab, opens it in Inbox without taking focus, starts pi and sends the prompt (never routing it into an existing session), and appends a footer telling the new session to `ag report` back to you (`--no-report` leaves it off). It prints the tab and AG Dash link; give Nathan the link. `--ws <workspace>`, `--cwd <dir>` or `--label <name>` open the tab yourself there instead. The Inbox auto-filer treats a session's second prompt as Nathan's first reply and moves it to a topic workspace, so a spin-out should get everything in its first prompt. Short-lived panes split beside you stay in your own tab.
- **Use other sessions freely.** You may start extra pi sessions (new tabs in the Inbox per the rule above, or panes beside you) to parallelize a task: independent investigations, long checks, a second machine's side of a change. Give each a clear self-contained prompt, keep them off files you're editing, read their results back, and close the tabs you created when done (`ag close <s>`). Nathan's standing permission; don't ask first. Never drive sessions you didn't create unless he points you at them.
- **Link to other sessions.** Whenever you mention another session (related work, where something is running, a session Nathan should look at), include its **AG Dash link** from `ag link <session>` (`ag link` alone is yours; several at once is fine; `--phone` for the https phone link). It prints `Workspace › Tab  http://ag:7376/<pi session id>`: AG Dash opens that session (transcript, reply, 🔥, Open in Herdr), or, if its tab is hibernated or closed, its transcript with Wake / Resume. Session ids are stable; tab ids change when the Inbox auto-filer moves a tab, so never hand-build links from tab ids. Put the URL on its own line, bare (no markdown link syntax): Herdr strips OSC 8 hyperlinks (tmux passes them), and Ghostty only auto-links standard schemes. `--url` prints just the URL (for HTML hrefs). `herdr-link --gemini <tab>` still prints the old direct-jump `gemini://<host>/focus/<tab_id>` link (HerdrLink.app → Hammerspoon, no browser) when a straight jump into Herdr is what's wanted.
- **Testing clicks.** CUA is blocked from controlling Ghostty, and synthetic Cmd+clicks don't trigger Ghostty's link hover, so a real click can only be verified by Nathan. Verify what the link opens instead: fetch the board link (`curl -s http://ag:7376/api/session/<id>` resolves it), or for a `--gemini` link open it on the client (`ssh <client> open '<url>'`), check `focused_tab_id` in `ag-mux api snapshot`, and restore his previous focus afterwards.
