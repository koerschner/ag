---
name: babysit
description: Commit, push, and keep fixing GitHub CI until it is green
argument-hint: "[commit message guidance]"
---

# Babysit CI

Commit all uncommitted changes, push them, then watch GitHub CI and keep fixing failures until the latest pushed commit is green.

Optional commit message guidance from the user:

$ARGUMENTS

## Process

1. Inspect the repository state.
   - Run `git status`.
   - Review changes with `git diff` and, if needed, `git diff --staged`.
   - Decide what should be committed. Do not include unrelated junk, temporary files, secrets, or generated artifacts unless they are intentionally part of the change.

2. Commit all appropriate uncommitted changes.
   - Stage files explicitly where practical.
   - Use the user's commit message guidance if provided and appropriate; otherwise choose a concise, accurate commit message.
   - Leave no intended changes uncommitted before pushing.

3. Push the current branch.
   - Push to the upstream branch.
   - If no upstream exists, set one for `origin/<current-branch>`.

4. Watch GitHub CI for the pushed HEAD.
   - Use `gh` to inspect and watch runs/checks, e.g. `gh run list`, `gh run watch`, `gh run view --log`, and/or `gh pr checks` when relevant.
   - Make sure the runs/checks belong to the latest pushed commit, not an older SHA.

5. If CI fails, fix it.
   - Inspect failing logs.
   - Make the smallest correct code/config/test fix.
   - Run the relevant local checks when possible.
   - Commit all fixes and push again.
   - Continue watching the new CI run.

6. Repeat until all required CI/checks for the latest pushed HEAD are green.

## Rules

- Do not stop just because CI is pending; keep watching.
- Do not declare success while any relevant check is pending, failed, cancelled, skipped unexpectedly, or for an older commit.
- If authentication, permissions, missing `gh`, or another external blocker prevents continuing, report the blocker clearly and stop.
- Do not ask the user for confirmation unless a destructive or ambiguous action is required.
