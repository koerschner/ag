---
description: Create a new git worktree for a branch
argument-hint: [branch-name]
---

Create a new git worktree for the branch "$1". Follow these steps:

1. First, check if the branch already exists locally or remotely using `git branch -a`
2. Determine the worktree path - use `../$(basename $(pwd))-$1` as the default location (sibling directory with branch name suffix)
3. If the branch exists, create the worktree with: `git worktree add <path> $1`
4. If the branch does not exist, create a new branch and worktree with: `git worktree add -b $1 <path>`
5. List all worktrees with `git worktree list` to confirm creation
6. Navigate to the new worktree directory using `cd <path>`
7. Confirm the new working directory and branch

If no branch name is provided, ask me what branch I want to work on.
