---
description: Merge and clean up a git worktree
argument-hint: [branch-name]
---

Merge the git worktree for branch "$1" back to the main branch and clean it up. Follow these steps:

1. Run `git worktree list` to see all worktrees and identify the one for branch "$1"
2. Determine the main branch (usually `main` or `master`) by checking `git symbolic-ref refs/remotes/origin/HEAD`
3. From the main worktree (current directory), ensure we're on the main branch
4. Merge the branch: `git merge $1`
5. If merge succeeds:
   - Remove the worktree: `git worktree remove <path>`
   - Delete the branch: `git branch -d $1`
   - Run `git worktree list` to confirm cleanup
6. If merge has conflicts, stop and report the conflicts - do NOT force remove the worktree

If no branch name is provided, list all worktrees with `git worktree list` and ask which one I want to merge.
