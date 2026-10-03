<!-- Session notes: everything agents need for working inside Ag's tmux sessions (ag-mux). Included into the global agent instructions under "Sessions (tmux via ag-mux)"; edit here, then run agents.md/build. -->

Assume you are running inside Ag's session layer, in an existing pane of an existing tab: tmux (`tmux -L ag`) on the session host, with `agd` adding stable IDs, agent states and events. Confirm with `test "$AG_MUX" = 1`; find your own tab, pane and link with `ag me` (`$AG_TAB_ID` goes stale once your pane moves). Drive it with **`ag-mux`** (docs/ag-mux.md in ag).

Hard rules:
- Never run bare `ag-mux`/`ag-mux attach` or `tmux attach` from a pane (they attach a terminal UI). Never run `tmux -L ag kill-server` or stop `ag-mux.service`.
- Never probe a mutating command by omitting args — `ag-mux tab create` with no flags *executes*.
- Commands return JSON; IDs and state live under `.result`. Parse them, never guess from status-bar order. Errors are JSON on stderr, exit 1 (exit 2 = syntax).
- `ag-mux --skill` prints the agent skill. Raw tmux is `tmux -L ag …`, for anything ag-mux doesn't cover.

# Mental model

- One flat list of **tabs** (`t8`, a tmux window) holding **panes** (`p4`); there are no workspaces. All tabs live in one tmux session (`ag`), and each attached terminal gets its own view of it. IDs are stable, never reused, and opaque (older ones look like `w3:t8`); a pane keeps its ID when it moves to another tab.
- **Pane commands** control raw terminals (shells, servers, tests). **Agent commands** control a recognized coding agent occupying a pane, with lifecycle states `idle` / `working` / `blocked` / `done` / `unknown`. `idle` and `done` both mean ready for input; `blocked` = approval/question dialog showing; `unknown` = present but unclassified (does not mean finished).
- Agent targets are a unique live agent name (`[a-z][a-z0-9_-]{0,31}`) or the pane ID hosting it — never a terminal ID or a bare kind like `pi`.
- Prefer `--current` to target your own pane. Never rely on the UI-focused pane; it may belong to the user or another client.

Spatial language refers to the tmux layout:
- "here" = the current pane (`ag-mux pane current --current`).
- "above/below/left/right" = the neighboring pane in that direction in the current tab (`ag-mux pane neighbor --current --direction up|down|left|right`).
- "tab" = a new tab (a window in the one tmux session), not a new tmux session.

# The `ag` CLI first

For anything at the session level, use `ag <verb>` (`ag help` lists them; `ag <verb> --help` for details) instead of hand-rolled `ag-mux … | jq`, curl to ag-dash or the inbox, or `jq` over `.jsonl` files. Every session argument takes a session id (or a unique prefix/suffix), a tab or pane id, an ag-dash link, or a label match, resolved fresh on each call (so no stale pane ids); the default is your own session. `--json` where machine output helps.

- Find and read: `ag me`, `ag ls [--inbox|--pinned|--waiting|--needs-you]`, `ag find <words>` (open, hibernated and closed sessions), `ag search <description>` (fuzzy, LLM-ranked, when the exact words are unknown), `ag peek <s>` (its screen), `ag read <s> [--user|--assistant] [--last N]` (its transcript), `ag link [s] [--phone]`.
- Act: `ag send <s> "msg" [--interrupt]`, `ag spawn "prompt"`, `ag report "msg"`, `ag merge <A…>`, `ag close [s]`, `ag rename "label" [s]`, `ag pin [on|off] [s]`, `ag wait [s]` / `ag unwait [s]`, `ag resume <s>`.
- System: `ag sync [ag|dotfiles]`, `ag status`, `ag logs <service> [-f]`, `ag restart <service>`; this machine: `ag setup` (install or update Ag here), `ag doctor` (what it still lacks).

# Working with panes and agents

Run `ag-mux --skill` for the command reference (reading panes, layout, running commands, starting and driving agents, waits). The rules that matter every time:

- **Reading is safe anywhere.** `ag ls`, `ag peek`, `ag read`, `ag find`, and raw `ag-mux tab list`, `ag-mux pane list`, `ag-mux agent list`, and `ag-mux pane read <pane> --source recent-unwrapped --lines 200` work on any pane; use them to orient when the user refers to work elsewhere ("the dev server", "the other agent").
- **Only send input** (`pane run`/`send-text`/`send-keys`, `agent prompt`/`send-keys`) to panes you created or the user pointed you at. Never answer another agent's `blocked` dialog without asking them.
- **Dev processes** (apps, servers, watchers): start each in a new tab with a descriptive label (or split beside yourself for something short-lived), group related processes as panes in one tab, always pass `--no-focus`, and tell the user the tab/pane labels and IDs. Never create a new tmux session unless asked; close only things you created.
- **`pane wait-output` also matches output that already exists**, including the echoed command line. Use an anchored sentinel that only appears on completion (`echo PROBE_DONE` + `--regex '^PROBE_DONE$'`).
- **Delegating to another agent** only when the user asks (see "Use other sessions freely" below for their standing permission): `agent start` needs an existing pane at a shell prompt; `agent prompt --wait` returning `agent_prompt_stalled` or `timeout` doesn't prove the prompt wasn't delivered, so read the pane before resending.
- `ag-mux notification show "<title>" [--body TEXT] [--sound done|request]` surfaces a toast to the user. A missing method is not a reason to restart agd or tmux.

# Helper sessions and links

- **Spin-outs go to the Inbox.** Whenever you spin out a new inquiry or side session in its own tab (a separate topic, a follow-up for the user to pick up, a helper pi session), open it as a new tab: `ag spawn "<self-contained prompt>"` (or `-f prompt.md`, or stdin). It goes through the ag-inbox, which names the tab, opens it without taking focus, starts pi and sends the prompt (never routing it into an existing session), and appends a footer telling the new session to `ag report` back to you (`--no-report` leaves it off). It prints the tab and ag-dash link; give the user the link. `--cwd <dir>` or `--label <name>` open the tab yourself instead. A new session sits in the Inbox until its second prompt, which counts as the user's first reply, so a spin-out should get everything in its first prompt. Short-lived panes split beside you stay in your own tab.
- **Use other sessions freely.** You may start extra pi sessions (new tabs per the rule above, or panes beside you) to parallelize a task: independent investigations, long checks, a second machine's side of a change. Give each a clear self-contained prompt, keep them off files you're editing, read their results back, and close the tabs you created when done (`ag close <s>`). The user's standing permission; don't ask first. Never drive sessions you didn't create unless they point you at them.
- **Link to other sessions.** Whenever you mention another session (related work, where something is running, a session the user should look at), include its **ag-dash link** from `ag link <session>` (`ag link` alone is yours; several at once is fine; `--phone` for the https phone link). It prints `Tab  http://ag:7376/<pi session id>`: ag-dash opens that session (transcript, reply, Pin, Open in tmux), or, if its tab is hibernated or closed, its transcript with Wake / Resume. Session ids are stable even after a tab closes or hibernates, so never hand-build links from tab ids. Put the URL on its own line, bare (no markdown link syntax); Ghostty only auto-links standard schemes. `--url` prints just the URL (for HTML hrefs).
- **Testing clicks.** CUA is blocked from controlling Ghostty, and synthetic Cmd+clicks don't trigger Ghostty's link hover, so a real click can only be verified by the user. Verify what the link opens instead: fetch the board link (`curl -s http://ag:7376/api/session/<id>` resolves it).
