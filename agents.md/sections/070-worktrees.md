## Worktrees

Always do new work in a git worktree so multiple things can be worked on at once. Never create or switch branches in the main checkout (e.g. `~/arcade.school`); leave it on its current branch.

- Create one worktree per task, as a sibling of the main checkout, named `~/<repo>-<short-topic>` (for arcade that is `~/arcade-<short-topic>`), based on the repo's integration branch (check `gh repo view --json defaultBranchRef` — for arcade it is `dev`, not `main`; `main` is production).
- Create it with plain git: `git -C ~/<repo> fetch origin && git -C ~/<repo> worktree add ~/<repo>-<short-topic> -b <branch> origin/<default-branch>`. Never create a workspace for a worktree — Nathan organizes sessions by topic workspaces, and per-worktree workspaces are empty duplicates. Only open one if he explicitly asks.
- Do all edits, installs, checks, commits, and pushes from inside that worktree (`cd` there from your own pane).
- Before starting, check `git worktree list` — reuse an existing worktree if one already exists for the branch.
- To know whether the cwd is a worktree: `git rev-parse --show-toplevel` differs from `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.
- Tell the user the worktree path you're working in.
- When presenting finished work to Nathan (e.g. before opening a PR, or a final report), always state the diff size as LOC `+N / -M` (from `git diff --shortstat <base>...HEAD`), on its own line at the very bottom of the message (just above `DONE`, if present).
- Once the work is merged, clean up: close any dev-process tabs you opened for it, remove the worktree (`git -C ~/<repo> worktree remove ~/<repo>-<short-topic>`), delete the local branch (`git -C ~/<repo> branch -D <branch>`), and delete the remote branch (`git -C ~/<repo> push origin --delete <branch>`, unless GitHub already deleted it on merge). Don't leave merged worktrees or branches lying around.
