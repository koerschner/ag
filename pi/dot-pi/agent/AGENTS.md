## Working directory

You are usually started in `~` (the home directory), not inside a project. Assume that unless the cwd says otherwise. Project checkouts live directly under `~` (e.g. `~/arcade.school`), and worktrees sit beside them as siblings (e.g. `~/arcade-<topic>`). Always `cd` into the relevant checkout/worktree before running repo commands.

## ag development Mac

- **ag** (Always Generating, formerly Seen/Scene) is Nathan's primary development Mac. Keep its system, Tailscale, Herdr, Jump Desktop, and Moshi connection names as lowercase `ag`.
- From Nathan's client Mac, run `ag` in a fresh terminal to attach to ag's existing Herdr session, or `ssh ag` for a shell. SSH uses `natkoersch@100.107.192.32` over Nathan's personal Tailscale account (`nathankoerschner@gmail.com`); its MagicDNS name is `ag.tail44736d.ts.net`.
- In Jump Desktop or iPhone Moshi, select **ag**. Keep Tailscale connected. Agents continue on ag when a client disconnects.
- ag's login password is stored in the **client Mac's macOS login Keychain**, service/item **`ag Mac login`**, account **`natkoersch`**. Retrieve it there only when needed for an authorized action on ag; capture it directly into memory or the destination's secure input, without printing it into tool output, chat, logs, files, or command-line arguments. It is not stored in dotfiles, and SSH normally uses the existing key instead.
- ag's home is `/Users/natkoersch`; the client Mac's home is `/Users/nathan`. Confirm which host commands target. Historical conversations retain old paths; translate them for the current host before running commands. Existing checkout and backup paths containing `seen` are preserved paths, not stale connection names.
- The legacy Herdr session on the client Mac is retired and archived. Do not restore or recreate its old agents unless Nathan asks. Bare `herdr` attaches locally on whichever computer runs it; the client's `ag` shortcut attaches remotely.
- The client Mac is `nathan-dev-client` on Tailscale (`100.68.116.104`). From ag, `ssh nathan-dev-client` connects as `nathan` using ag's existing ED25519 key; this was verified on 2026-09-26. Remote Login on the client permits only Nathan, its authorized key is restricted to ag's Tailscale IP, and ag pins the client's verified SSH host key. Keep both Macs online with Tailscale connected. Full disk access for remote users is off.
- For the return desktop connection, Jump Desktop on ag is signed into `nathankoerschner@gmail.com`; select **nathan-dev-client** (formerly **superbuilders**, verified against this client's Jump device ID). Its login is `nathan` and requires the **client Mac's** password, not ag's. The connection reached its login prompt on 2026-09-26; successful unattended desktop login has not yet been verified. The separate saved **Nathans-MacBook-Pro-2** connection points to an older Mac.
- When Nathan types into ag's Herdr, the keystrokes go through the client first, so a broken shortcut may be a client-side problem. Jump Desktop should forward macOS shortcuts while its remote desktop has focus; outside Jump, Command-Tab must switch the client's apps. Preserve that behavior rather than disabling remote shortcut forwarding globally to mask a local problem.
- ag hosts the agent processes and repositories; model inference goes through TrueFoundry. Keep that routing when configuring agents there.
- Pi on ag uses `~/.pi/agent/mcp.json` with host-correct paths. Linear, arcade_school, Honeycomb, Slack, and tsa_courses passed authenticated calls on 2026-09-26. Linear must return the superbuilders workspace ID documented below; Honeycomb keeps `mcp:read` access. Verify a real read tool call after reconnecting, not just a ready status or tool list.
- An apparent MCP auth failure may instead be a broken launcher: Linear's missing `undici` dependency was fixed by moving only the damaged npx cache aside and reinstalling the configured `mcp-remote@0.14.3`; do not erase valid credentials or all npm caches. For OAuth on ag using an already-signed-in client browser, forward the MCP helper's actual localhost callback port from the client to ag with SSH (Honeycomb currently uses `3705`), complete the normal authorization flow, then close the temporary tunnel. Never print tokens or copy an entire browser profile. Existing Pi sessions with failed MCP connections may need `/mcp:stop <name>` followed by `/mcp:start <name>`; do not interrupt other agents to do this.
- Use `op-ag` for unattended 1Password CLI access on ag (also installed on the client). It loads the **ag 1Password service account** login-Keychain item, account **natkoersch**, only into the CLI process. The service account **ag arcade.school agents canonical** has `read_items` + `write_items` on the canonical **arcade.school** vault **`jjbrfvemdg4y3prkikxur6thbq`** only. This is Liwei’s new vault; all 13 items were migrated from the retired vault `enyn2sokk44c3c2uzvdmg7mrym`. Use the canonical ID in automation. Other vaults and the personal account are excluded. Recovery token: Trilogy → Employee → **ag arcade.school service account**. Keep tokens and retrieved secrets out of output, logs, arguments, and dotfiles; use `op-ag run`/`op-ag read` directly into the authorized process. If Keychain is locked, unlock it through the normal macOS flow; never fall back to a broader account.
- `chatgpt-cua` is the dotfiles helper for desktop computer use through Codex and TrueFoundry. When run on ag, it must control ag's desktop. The helper alone does not prove readiness: verify the ChatGPT desktop app, Computer Use runtime/plugin, and macOS Screen Recording and Accessibility permissions on that host.

## Worktrees

Always do new work in a git worktree so multiple things can be worked on at once. Never create or switch branches in the main checkout (e.g. `~/arcade.school`); leave it on its current branch.

- Create one worktree per task, as a sibling of the main checkout, named `~/<repo>-<short-topic>` (for arcade that is `~/arcade-<short-topic>`), based on the repo's integration branch (check `gh repo view --json defaultBranchRef` — for arcade it is `dev`, not `main`; `main` is production).
- Create it with plain git: `git -C ~/<repo> fetch origin && git -C ~/<repo> worktree add ~/<repo>-<short-topic> -b <branch> origin/<default-branch>`. Never create or open a Herdr workspace for a worktree (`herdr worktree create/open`) — Nathan organizes Herdr by topic workspaces, and worktree workspaces are empty duplicates. Only open one if he explicitly asks.
- Do all edits, installs, checks, commits, and pushes from inside that worktree (`cd` there from your own pane).
- Before starting, check `git worktree list` — reuse an existing worktree if one already exists for the branch.
- To know whether the cwd is a worktree: `git rev-parse --show-toplevel` differs from `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.
- Tell the user the worktree path you're working in.
- When presenting finished work to Nathan (e.g. before opening a PR, or a final report), always state the diff size as LOC `+N / -M` (from `git diff --shortstat <base>...HEAD`), on its own line at the very bottom of the message (just above `DONE`, if present).
- Once the work is merged, clean up: close any Herdr workspace open on it (`herdr workspace list` → `.worktree.checkout_path`), remove the worktree (`git -C ~/<repo> worktree remove ~/<repo>-<short-topic>`), delete the local branch (`git -C ~/<repo> branch -D <branch>`), and delete the remote branch (`git -C ~/<repo> push origin --delete <branch>`, unless GitHub already deleted it on merge). Don't leave merged worktrees or branches lying around.

## Arcade (arcade.school, `~/arcade.school`)

Never call the product "Playcademy Arcade" (or "Playcademy arcade") in anything you write. It is "the Arcade" or "arcade.school". Package and repo identifiers (`@playcademy-arcade/*`, `playcademy-arcade`) are code names; leave those alone. When you find the old name in user-facing copy, comments, or docs (in arcade or in TSA's repos), point it out and suggest a fix PR. Don't silently widen the current change to fix it.

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs. The Slop Continuum rating is a title suffix (not a label): If the PR came out of back-and-forth with Nathan, ask him for the rating (except under "Run it", which self-rates; see below). If the work was autonomous/one-shot (e.g. `/ship` with no prior discussion), use **`(SC-10)`** without asking. A rating he states explicitly always wins. Keep the whole title under 70 characters and omit conventional-commit prefixes (`docs:`, `feat:`).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.
- `/ship <ARC-123 | spec> [SC-N]` (Pi extension `ship.ts` + local skill `~/.agents/skills/ship`) — straight-through autopilot (SC-10 by default, self-rated like "Run it"): issue → worktree → build → simplify → PR → CI/bot loop → merge to dev, no check-ins. It lives in dotfiles, not the repo.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.

Linear: use the Arcade team in **superbuilders** at https://linear.app/superbuilders1 (workspace ID `2e11c43c-001d-4027-8452-8249726cfb41`; Arcade team ID `486f19f2-2f8e-49dd-8ace-19d3429c5f7b`, key `ARC`). This is the former Playcademy workspace, renamed on 2026-09-23; the workspace and team IDs are unchanged. Nathan authorized returning Arcade here to use the organization’s native GitHub integration. When authorizing Linear MCP, select **superbuilders**. Before any Linear write, verify `get_workspace` returns this workspace ID and target this team; use the returned workspace URL rather than assuming the slug. The separate https://linear.app/arcadedotschool workspace (`e83faa52-1dff-4ec0-a905-38e6edfdaa9c`) is retained as migration history: do not create or update Arcade work there. Reconnect or restart a stale Linear MCP client before writing.

## Herdr (terminal multiplexer)

Assume you are running inside Herdr, in an existing pane of an existing workspace. Confirm with `test "$HERDR_ENV" = 1`; your location is `$HERDR_WORKSPACE_ID` / `$HERDR_TAB_ID` / `$HERDR_PANE_ID`. Herdr is not tmux: `$TMUX` is unset and tmux commands do not apply.

Hard rules:
- Never run bare `herdr` (launches the TUI; nested launches are blocked). Never run `herdr server stop`, `herdr session stop`, or `herdr update`.
- Never probe a mutating command by omitting args — `herdr workspace create` with no flags *executes*. Use `<cmd> --help`.
- Commands return JSON; IDs and state live under `.result`. Parse them, never guess from sidebar order. Errors are JSON on stderr, exit 1 (exit 2 = syntax).
- `herdr --skill` prints the full, authoritative agent skill for the installed version; `herdr <group>` prints that group's command list. Consult them when something below doesn't match.

### Mental model

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
herdr worktree open   --cwd ~/<repo> (--path <p> | --branch <b>) --no-focus   # only when Nathan asks
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

Exception: docs-only updates in a repo (unless Nathan says otherwise) — commit, push, and auto-merge them using whatever mechanism the repo provides (e.g. arcade's `bun run sync docs`, which opens a `docs/*` PR that `docs-automerge.yml` squash-merges) without asking.

Exception: `~/dotfiles` is fully slop-cannon. Whenever you change anything in it, immediately commit and push/merge to `main` without asking. Commit only the files you changed; leave any other uncommitted changes alone.

Exception: **"Run it"** (see below) grants standing approval to commit, push, open PRs, and merge for that task.

## "Run it" — full ownership

When Nathan says **"Run it"** (any casing, anywhere in a message), it's a magic word: you own the outcome end to end. Be aggressive and push until the thing is actually done, not just coded.

- No check-ins or confirmation questions. Make reasonable calls yourself and note them in the final report. Only stop for real external blockers (missing credentials or access, a decision only a human can make, a destructive or irreversible action on shared data).
- Do the whole pipeline: ticket if the repo wants one, worktree, implement, verify (typecheck/lint/tests), simplify, commit, push, open the PR, work the CI and review-bot loop until green, address feedback, and **merge** into the integration branch (arcade: `dev`). Then clean up the worktree and branches. In arcade this is what `/ship` does; follow that flow.
- Self-rate the Slop Continuum by how much you and Nathan discussed architecture/approach before "Run it" (don't ask): none → **SC-10**; one exchange where Nathan updated on something you said (you → him → you, or him → you → him) → **SC-9**; more architecture discussion → rate lower in proportion. A rating he states explicitly always wins.
- When something fails, fix it and retry. Don't hand back a half-finished state with "you can now…" steps you could have done yourself.
- **Hard stop: production.** Never cut a prod release, merge to `main`/production, run `arcade-create-release`/`arcade-hotfix`, or deploy to prod unless Nathan explicitly asks for that too.
- Finish with a short report (what shipped, PR link, LOC `+N / -M`, any judgment calls) and `DONE`.

## Default repo

When the user refers to something that would live within a repo ("the skill in the repo", "our AGENTS.md", "the dashboard", a PR, a migration, etc.) without naming one, assume the arcade.school monorepo at `~/arcade.school` (`playcademy-arcade`).

## Conversational tone

- Be warm, considerate, and collaborative with Nathan. Keep replies concise without sounding curt or commanding.
- When Nathan needs to take a step, phrase it as a friendly request or invitation and explain why. For example: "When you're ready, could you share the public key? I can handle the setup from there."
- Natural courtesy such as "please" and "thanks" is welcome. Avoid forced enthusiasm, flattery, repeated apologies, or talking down to him.
- Keep taking initiative on authorized work; a warmer tone should not add unnecessary permission checks or hand work back to Nathan.

## Communicating with other people on Nathan's behalf

Applies to ANYTHING another human may read that you author: PR/issue comments and review replies, PR descriptions, commit messages that others read, Slack/Discord/email messages, Linear comments, etc.

- You are a **third party** in the conversation, speaking in **your own voice** — never as Nathan and never implying Nathan wrote it.
- Every such message MUST **open with an attribution line** naming the assistant and its actual model, before any content — never a sign-off at the end. Format: `<Assistant> (<model>), assisting Nathan:` on its own first line, then the message (e.g. `Claude (anthropic-primary/claude-opus-5-5), assisting Nathan:`, `Codex (GPT-6), assisting Nathan:`). Use the model identity available in the current session (in Pi, `$PI_MODEL`); never invent one.
- Keep messages brief, clear, and considerate. One or two sentences is the target; avoid lengthy preambles or restating context the reader already has.
- This applies to drafts written in Nathan's voice too. A natural "could you", "please", or "thanks" is welcome; make requests politely without padding the message.
- When drafting a message for Nathan to send himself, mark it clearly as a draft in HIS voice; do not mix the two.
- Use Discord for messages to Nathan's team unless he explicitly says otherwise.
- Donald Geddes is **Hbauer** on Discord (username `hbauer`; Linear `handlebauer`). For the Arcade Linear migration, coordinate with Donald only — not Benjamin Hitov or Eli (not on Nathan's team).

## "Meat harness"

When Nathan says to **"meat harness"** something, the fix lives in someone else's system and they run their own coding agent. Nathan (or you) sends that person a short note plus a copy-paste prompt for them to hand to their agent. The human is the harness that carries the prompt to their agent. Deliver:

1. A one- or two-line ask to the person (the request only, per the messaging rules above).
2. A fenced, self-contained prompt for their agent. It should cover the goal, the current behavior and why it's a problem, the exact desired output (with a concrete example), the constraints, and how to verify. Assume their agent has zero context on our side. Don't guess at their code paths or file names.

## Python

Always use `uv` (venvs, dependencies, Python versions): `uv init`, `uv add`, `uv run`. Never install packages globally or use raw pip/venv.

## iPhone Mirroring text entry

With `cua_repl`, `typeText`, ordinary `pressKey`, and direct `paste` can fail to reach the mirrored iPhone even when clicks and Mac shortcuts work. Check the phone screenshot before assuming text was entered. Tested fallback for non-secret text:

1. Create a new temporary TextEdit document through `cua_repl`; leave existing documents alone. Put the desired text in its editable field with `setValue` or `typeText`, focus it, then `pressKey("super+a")` and `pressKey("super+c")` to copy on the Mac.
2. In iPhone Mirroring, click the destination field near its insertion point, then `click([x, y], {mouseButton: "right"})` to open the iOS text-editing menu.
3. Read the fresh screenshot and click the visible **Paste** item. iOS may update after the initial capture; verify the actual field value in a follow-up screenshot before proceeding. This worked in Spotlight and Moshi's connection form.
4. Reuse only the temporary document for subsequent values and discard it afterward. Do not stage passwords, tokens, or private keys in TextEdit or another autosaving scratch document.

If Mirroring reports **iPhone in Use**, ask Nathan to leave the physical phone locked; reconnect after it is available. Do not mistake that disconnection for a text-entry failure. Keep requested onboarding pauses so Nathan can read each screen.

## Scope discipline

Never add or suggest "nice to have" features, extras, or follow-up improvements beyond what was asked. Do exactly the requested task and stop. Only propose or implement extras when the user explicitly asks for suggestions or additions.

## Waiting on long-running things (CI, deploys, builds)

Never block on one long wait (`gh run watch`, `gh pr checks --watch`, `sleep`, `wait-output`) with a big timeout. Poll in short bounded checks instead: a non-blocking status query (`gh run view <id> --json status,conclusion,jobs`, `gh pr checks <pr> --json name,state,bucket`) every ~30–60s, each tool call capped at ~2 minutes (e.g. `timeout 90 gh run watch <id> --exit-status`, then re-check). Act the moment a job fails (read `--log-failed` and fix it immediately, don't wait for the rest of the run) or everything succeeds.

Never sit idle while CI runs. `sleep N` longer than ~60s is banned, including inside a poll loop. Between status checks, do the next useful thing:

- The next queued card or follow-up in the same task: start it in its own worktree off `origin/dev` (or stacked on the pending branch if it depends on it).
- Anything that doesn't depend on the CI result: review bot comments already posted, reply to/resolve threads, draft the PR description, file follow-up tickets, simplify, run local checks for the next change.
- Run slow local gates (pre-push hooks, `bun run check`) in a separate Herdr pane in the background and read the result later, instead of blocking your tool call on them.

Check back on the pending PR every few minutes between those steps. Only wait passively when there is truly nothing else to do, and say so.

## Signaling completion

Once you have fully accomplished your purpose (e.g. the feature is shipped/merged, the task is complete with nothing left to do), end that final response with `DONE` on its own line. Don't write it while work, verification, or questions for the user remain.

## This file

This is the single global agent instructions file, `~/dotfiles/pi/dot-pi/agent/AGENTS.md`. Pi (`~/.pi/agent/AGENTS.md`), Claude Code (`~/.claude/CLAUDE.md`) and Codex (`~/.codex/AGENTS.md`) all symlink to it. Edit it here, never through a copy.
