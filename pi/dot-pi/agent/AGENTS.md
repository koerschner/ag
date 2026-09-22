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

## Arcade (arcade.school, `~/arcade.school`)

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs (requires the user's Slop Continuum rating).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.
- `arcade-ship` — the SC-10 autopilot (issue → worktree → plan with bone pre-check → build → simplify → PR → CI/bot loop → bones check → merge to dev). In Pi, start it with `/ship <ARC-123 | spec> [SC-N]` (extension `ship.ts`): the harness re-prompts between turns and only accepts `ship_done` once `gh` confirms the PR merged without the `bones` label. Any bone move (`bun run bones check`, manifest `docs/architecture/bones.yml`) is a halt, never an override — see `docs/architecture/bones.md` in the repo.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.

## Herdr (terminal multiplexer)

Assume you are running inside Herdr, in an existing pane of an existing workspace. Confirm with `test "$HERDR_ENV" = 1`; your location is `$HERDR_WORKSPACE_ID` / `$HERDR_TAB_ID` / `$HERDR_PANE_ID`. Herdr is not tmux: `$TMUX` is unset and tmux commands do not apply. Never run bare `herdr` (it launches the TUI; nested launches are blocked) and never run `herdr server stop`. `herdr --help` and `herdr <group>` (e.g. `herdr pane`) print the current CLI; commands return JSON — read IDs from `.result`.

Spatial language refers to the Herdr layout:
- "here" means the current pane (`herdr pane current --current`; read its output with `herdr pane read "$HERDR_PANE_ID" --source recent-unwrapped --lines <n>`).
- "above", "below", "left", "right" mean the neighboring pane in that direction in the current tab (`herdr pane neighbor --current --direction up|down|left|right`).
- "tab" means a new tab in the current workspace (`herdr tab create --label <name> --cwd <dir> --no-focus`), not a new workspace or session.
- "workspace" means a Herdr workspace (one per repo/worktree), not a session.

When running development processes (apps, dev servers, watchers):
- Never create a new session or workspace unless explicitly asked. Work inside the current workspace.
- Start each task in a new tab in the current workspace with a descriptive label, or split beside yourself for something short-lived: `herdr pane split --current --direction right|down --cwd "$PWD" --no-focus`, then `herdr pane run <pane-id> "<cmd>"`, `herdr pane wait-output <pane-id> --match <text> --timeout <ms>`, `herdr pane read <pane-id> --source recent-unwrapped --lines <n>`.
- If a task involves multiple related processes/services, group them as panes within that one new tab rather than spreading them across tabs.
- Use `--no-focus` so the user's focus stays put. Only close panes/tabs you created.
- Tell the user which tab and panes things are running in (label and IDs).

Never create a git commit without consulting the user first and receiving explicit approval.

## Default repo

When the user refers to something that would live within a repo ("the skill in the repo", "our AGENTS.md", "the dashboard", a PR, a migration, etc.) without naming one, assume the arcade.school monorepo at `~/arcade.school` (`playcademy-arcade`).

## Communicating with other people on Nathan's behalf

Applies to ANYTHING another human may read that you author: PR/issue comments and review replies, PR descriptions, commit messages that others read, Slack/Discord/email messages, Linear comments, etc.

- You are a **third party** in the conversation, speaking in **your own voice** — never as Nathan and never implying Nathan wrote it.
- Every such message MUST **disclaim and cite** that an AI wrote it, naming the model, e.g. a lead-in or sign-off like: `— written by Claude (model: $PI_MODEL), an AI agent working with Nathan`. Use the actual `PI_MODEL` value at runtime.
- Keep messages **as short and thin as possible**. No preamble, no pleasantries, no restating context the reader already has. One or two sentences is the target. Do not annoy people.
- When drafting a message for Nathan to send himself, mark it clearly as a draft in HIS voice; do not mix the two.

## Scope discipline

Never add or suggest "nice to have" features, extras, or follow-up improvements beyond what was asked. Do exactly the requested task and stop. Only propose or implement extras when the user explicitly asks for suggestions or additions.
