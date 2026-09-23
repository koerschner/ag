## Working directory

You are usually started in `~` (the home directory), not inside a project. Assume that unless the cwd says otherwise. Project checkouts live directly under `~` (e.g. `~/arcade.school`), and worktrees sit beside them as siblings (e.g. `~/arcade-<topic>`). Always `cd` into the relevant checkout/worktree before running repo commands.

## Worktrees

Always do new work in a git worktree so multiple things can be worked on at once. Never create or switch branches in the main checkout (e.g. `~/arcade.school`); leave it on its current branch.

- Create one worktree per task, as a sibling of the main checkout, named `~/<repo>-<short-topic>` (for arcade that is `~/arcade-<short-topic>`), based on the repo's integration branch (check `gh repo view --json defaultBranchRef` — for arcade it is `dev`, not `main`; `main` is production).
- Inside Herdr (the normal case), create it with Herdr so it also appears as a grouped workspace in the sidebar:
  `git -C ~/<repo> fetch origin && herdr worktree create --cwd ~/<repo> --branch <branch> --base origin/<default-branch> --path ~/<repo>-<short-topic> --no-focus`
  Outside Herdr, fall back to `git -C ~/<repo> worktree add ~/<repo>-<short-topic> -b <branch> origin/<default-branch>`.
- Do all edits, installs, checks, commits, and pushes from inside that worktree (`cd` there; the worktree workspace's pane is for the user, keep working in your own pane).
- Before starting, check `git worktree list` — reuse an existing worktree if one already exists for the branch. If it exists but isn't open in Herdr, `herdr worktree open --cwd ~/<repo> --path <worktree> --no-focus`.
- To know whether the cwd is a worktree: `git rev-parse --show-toplevel` differs from `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.
- Tell the user the worktree path you're working in.
- Once the work is merged, clean up: remove the worktree (`git -C ~/<repo> worktree remove ~/<repo>-<short-topic>`), delete the local branch (`git -C ~/<repo> branch -D <branch>`), and delete the remote branch (`git -C ~/<repo> push origin --delete <branch>`, unless GitHub already deleted it on merge). Don't leave merged worktrees or branches lying around.

## Arcade (arcade.school, `~/arcade.school`)

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs. The Slop Continuum rating is a title suffix (not a label): If the PR came out of back-and-forth with Nathan, ask him for the rating. If the work was autonomous/one-shot, use **`(SC-10)`** without asking. A rating he states explicitly always wins. Keep the whole title under 70 characters and omit conventional-commit prefixes (`docs:`, `feat:`).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.

Linear: use https://linear.app/arcade-school (workspace ID `e83faa52-1dff-4ec0-a905-38e6edfdaa9c`; Arcade team ID `38e3b708-4846-43b4-97d3-b7b0005cf2f6`, key `ARC`). The old Arcade team in the Playcademy workspace was retired on 2026-09-21 — never use Playcademy for Arcade work. ARC issue numbers were preserved.

## Herdr (terminal multiplexer)

Assume you are running inside Herdr, in an existing pane of an existing workspace. Confirm with `test "$HERDR_ENV" = 1`; your location is `$HERDR_WORKSPACE_ID` / `$HERDR_TAB_ID` / `$HERDR_PANE_ID`. Herdr is not tmux: `$TMUX` is unset and tmux commands do not apply.

Hard rules:
- Never run bare `herdr` (launches the TUI; nested launches are blocked). Never run `herdr server stop`, `herdr session stop`, or `herdr update`.
- Never probe a mutating command by omitting args — `herdr workspace create` with no flags *executes*. Use `<cmd> --help`.
- Commands return JSON; IDs and state live under `.result`. Parse them, never guess from sidebar order. Errors are JSON on stderr, exit 1 (exit 2 = syntax).
- `herdr --skill` prints the full, authoritative agent skill for the installed version; `herdr <group>` prints that group's command list. Consult them when something below doesn't match.

### Mental model

- **Workspace** (`w3`) → **tab** (`w3:t8`) → **pane** (`w3:p4`). One workspace per repo/worktree. IDs are stable and never reused; a pane moved to another workspace gets a new ID (`.result.move_result.pane.pane_id`).
- **Pane commands** control raw terminals (shells, servers, tests). **Agent commands** control a recognized coding agent occupying a pane, with lifecycle states `idle` / `working` / `blocked` / `done` / `unknown`. `idle` and `done` both mean ready for input; `blocked` = approval/question dialog showing; `unknown` = present but unclassified (does not mean finished).
- Agent targets are a unique live agent name (`[a-z][a-z0-9_-]{0,31}`) or the pane ID hosting it — never a terminal ID or a bare kind like `pi`.
- Prefer `--current` to target your own pane. Never rely on the UI-focused pane; it may belong to the user or another client.

Spatial language refers to the Herdr layout:
- "here" = the current pane (`herdr pane current --current`).
- "above/below/left/right" = the neighboring pane in that direction in the current tab (`herdr pane neighbor --current --direction up|down|left|right`).
- "tab" = a new tab in the current workspace, not a new workspace or session.
- "workspace" = a Herdr workspace (one per repo/worktree), not a session.

### Seeing what's in motion (tmux `capture-pane` equivalent)

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

### Creating layout

```bash
herdr pane split --current --direction right|down --cwd "$PWD" [--ratio 0.5] --no-focus   # → .result.pane.pane_id
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label <name> --cwd <dir> --no-focus   # → .result.tab, .result.root_pane
herdr workspace create --cwd <dir> --label <name> --no-focus                                # → .result.workspace/.tab/.root_pane (only when asked)
herdr worktree create --cwd ~/<repo> --branch <b> --base origin/<default> --path ~/<repo>-<topic> --no-focus
herdr worktree open   --cwd ~/<repo> (--path <p> | --branch <b>) --no-focus
herdr worktree list   --cwd ~/<repo>
herdr pane rename <pane-id> <name>   |  herdr tab rename <tab-id> <name>  |  herdr workspace rename <ws> <name>
herdr pane zoom / resize / swap / move / focus / close    (see --help)
herdr pane close <pane-id>  |  herdr tab close <tab-id>   # only things you created
```

Split direction: check `herdr pane layout --pane "$HERDR_PANE_ID"`; split wide panes `right`, narrow/tall ones `down`; avoid stacking same-direction splits into slivers. Always `--no-focus` so the user's focus stays put. `--trust-repository` on worktree commands only after the user has vetted the repo — not a retry flag.

### Running commands in panes

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

### Starting and driving another agent

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

### Other

- `herdr notification show "<title>" [--body TEXT] [--sound done|request]` — surface a toast to the user (e.g. long job finished).
- `herdr status` — client/server versions (check before relying on a new feature; a missing method is not a reason to restart/upgrade).
- `herdr --machine <label> <cmd>` — run any of the above against a saved SSH machine; discover IDs there, don't reuse local ones. `herdr machine list` shows profiles only. Don't add/remove profiles unless asked.
- `herdr session ...` — named persistent servers; leave alone unless asked.
- `herdr api schema` — full socket API schema if a CLI flag is missing.

Never create a git commit without consulting the user first and receiving explicit approval.

## Default repo

When the user refers to something that would live within a repo ("the skill in the repo", "our AGENTS.md", "the dashboard", a PR, a migration, etc.) without naming one, assume the arcade.school monorepo at `~/arcade.school` (`playcademy-arcade`).

## Communicating with other people on Nathan's behalf

Applies to ANYTHING another human may read that you author: PR/issue comments and review replies, PR descriptions, commit messages that others read, Slack/Discord/email messages, Linear comments, etc.

- You are a **third party** in the conversation, speaking in **your own voice** — never as Nathan and never implying Nathan wrote it.
- Every such message MUST **open with an attribution line** naming the assistant and its actual model, before any content — never a sign-off at the end. Format: `<Assistant> (<model>), assisting Nathan:` on its own first line, then the message (e.g. `Claude (anthropic-primary/claude-opus-5-5), assisting Nathan:`, `Codex (GPT-6), assisting Nathan:`). Use the model identity available in the current session (in Pi, `$PI_MODEL`); never invent one.
- Keep messages **as short and thin as possible**. No preamble, no pleasantries, no restating context the reader already has. One or two sentences is the target. Do not annoy people.
- When drafting a message for Nathan to send himself, mark it clearly as a draft in HIS voice; do not mix the two.
- Use Discord for messages to Nathan's team unless he explicitly says otherwise.
- Donald Geddes is **Hbauer** on Discord (username `hbauer`; Linear `handlebauer`). For the Arcade Linear migration, coordinate with Donald only — not Benjamin Hitov or Eli (not on Nathan's team).

## Python

Always use `uv` (venvs, dependencies, Python versions): `uv init`, `uv add`, `uv run`. Never install packages globally or use raw pip/venv.

## Scope discipline

Never add or suggest "nice to have" features, extras, or follow-up improvements beyond what was asked. Do exactly the requested task and stop. Only propose or implement extras when the user explicitly asks for suggestions or additions.

## This file

This is the single global agent instructions file, `~/dotfiles/pi/dot-pi/agent/AGENTS.md`. Pi (`~/.pi/agent/AGENTS.md`), Claude Code (`~/.claude/CLAUDE.md`) and Codex (`~/.codex/AGENTS.md`) all symlink to it. Edit it here, never through a copy.
