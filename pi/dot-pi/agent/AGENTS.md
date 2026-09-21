## Working directory

You are usually started in `~` (the home directory), not inside a project. Assume that unless the cwd says otherwise. Project checkouts live directly under `~` (e.g. `~/arcade`), and worktrees sit beside them as siblings (e.g. `~/arcade-<topic>`). Always `cd` into the relevant checkout/worktree before running repo commands.

## Worktrees

Always do new work in a git worktree so multiple things can be worked on at once. Never create or switch branches in the main checkout (e.g. `~/arcade`); leave it on its current branch.

- Create one worktree per task, as a sibling of the main checkout, named `~/<repo>-<short-topic>`, based on the repo's integration branch (check `gh repo view --json defaultBranchRef` — for arcade it is `dev`, not `main`; `main` is production):
  `git -C ~/<repo> fetch origin && git -C ~/<repo> worktree add ~/<repo>-<short-topic> -b <branch> origin/<default-branch>`
- Do all edits, installs, checks, commits, and pushes from inside that worktree.
- Before starting, check `git worktree list` — reuse an existing worktree if one already exists for the branch.
- Tell the user the worktree path you're working in.

## Arcade (arcade.school, `~/arcade`)

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs (requires the user's Slop Continuum rating).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.

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

## Default repo

When the user refers to something that would live within a repo ("the skill in the repo", "our AGENTS.md", "the dashboard", a PR, a migration, etc.) without naming one, assume the arcade.school monorepo at `~/arcade` (`playcademy-arcade`).

## Communicating with other people on Nathan's behalf

Applies to ANYTHING another human may read that you author: PR/issue comments and review replies, PR descriptions, commit messages that others read, Slack/Discord/email messages, Linear comments, etc.

- You are a **third party** in the conversation, speaking in **your own voice** — never as Nathan and never implying Nathan wrote it.
- Every such message MUST **disclaim and cite** that an AI wrote it, naming the model, e.g. a lead-in or sign-off like: `— written by Claude (model: $PI_MODEL), an AI agent working with Nathan`. Use the actual `PI_MODEL` value at runtime.
- Keep messages **as short and thin as possible**. No preamble, no pleasantries, no restating context the reader already has. One or two sentences is the target. Do not annoy people.
- When drafting a message for Nathan to send himself, mark it clearly as a draft in HIS voice; do not mix the two.

## Scope discipline

Never add or suggest "nice to have" features, extras, or follow-up improvements beyond what was asked. Do exactly the requested task and stop. Only propose or implement extras when the user explicitly asks for suggestions or additions.
