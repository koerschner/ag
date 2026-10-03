---
name: babysit
description: Commit, push, open/update the PR, then keep fixing CI failures and bot review findings (Bugbot etc.) until everything is green and clean
argument-hint: "[commit message / PR guidance]"
---

# Babysit PR

Commit all uncommitted changes, push, make sure a PR exists, then loop: watch GitHub CI **and** automated review bots (Cursor Bugbot, Copilot, CodeRabbit, and similar) on the PR, and systematically fix every failure and finding — delegating each fix to a subagent — until the latest pushed commit is green and has no unresolved bot findings.

Optional guidance from the user (commit message, PR title, scope notes):

$ARGUMENTS

## Phase 1 — Commit and push

1. Inspect the repository state: `git status`, `git diff`, `git diff --staged`.
   - Do not include unrelated junk, temp files, secrets, or generated artifacts unless intentionally part of the change.
2. Commit all appropriate uncommitted changes. Use the user's guidance if provided; otherwise write a concise, accurate message.
3. Push the current branch. If no upstream exists, set one: `git push -u origin <branch>`.
4. Ensure a PR exists.
   - `gh pr view --json number,url,state,isDraft` — if there is none, create one with `gh pr create --fill` (improve the title/body from the diff when `--fill` is poor; incorporate user guidance). Non-draft unless the user said otherwise.
   - Record the PR number and HEAD SHA; you will use them throughout.

## Phase 2 — Watch loop

Repeat the following until the exit condition is met. Track the current HEAD SHA at all times; ignore anything attached to older SHAs.

### 2a. Gather CI status

- `gh pr checks <pr> --json name,state,bucket,link` and/or `gh run list --commit <sha>`; `gh run view <id> --log-failed` for failures.
- Wait for pending checks by polling every ~30–60s with short bounded calls (each ≤ ~2 min, e.g. `timeout 90 gh run watch <id> --exit-status`), never one long watch. Act on a failure as soon as it appears. Do not stop because things are pending.

### 2b. Gather bot review findings

Review bots post as review comments and/or reviews. Collect all of them for the PR:

- Inline review comments: `gh api repos/{owner}/{repo}/pulls/<pr>/comments --paginate`
- Reviews: `gh api repos/{owner}/{repo}/pulls/<pr>/reviews --paginate`
- Issue-level comments: `gh api repos/{owner}/{repo}/issues/<pr>/comments --paginate`
- Thread resolution state (GraphQL): `pullRequest.reviewThreads { isResolved isOutdated comments { author body path line } }` — use this to skip threads already resolved.

Treat authors that are bots or app accounts (e.g. `cursor[bot]`, `cursor`, `bugbot`, `copilot-pull-request-reviewer[bot]`, `coderabbitai[bot]`, `github-actions[bot]`, any `[bot]`/`type: Bot` account) as bot reviewers. Also include unresolved comments from humans if they request a concrete change.

**Give the bots time to review.** After every push, wait for the bot's pass to complete before deciding there are no findings: look for a bot check-run/status (e.g. a "Bugbot" or "Cursor" check) to finish, or for a bot summary comment/review created after the push. If neither appears, poll every ~60s for up to ~10 minutes after the push (and after CI finishes) before concluding the bot has nothing to say.

### 2c. Triage

Build a deduplicated list of open items: each failing CI check, and each unresolved bot finding (path, line, body, comment id / thread id). For each finding decide:

- **Fix** — real bug, real risk, or a reasonable improvement. Default to fixing.
- **Decline** — clearly a false positive, out of scope for this PR, or would make the code worse. Only decline when you are confident. Reply on the thread with a one-to-two-sentence explanation and resolve it (GraphQL `resolveReviewThread`).

### 2d. Fix — one subagent per item

For every item marked **Fix**, delegate to the `worker` subagent. Give it a self-contained task:

- Repo path and branch.
- The exact finding: file, line(s), the bot's comment verbatim, or the failing check name plus the relevant log excerpt.
- Instructions: make the smallest correct fix, run the relevant local checks/tests for the touched code, **do not commit**, and report the files changed and what was done.

Batching rules:

- Run items **in parallel** when they touch clearly different files. Run items **sequentially** when they overlap in files, or when you cannot tell.
- Fix CI failures before bot findings when both exist, since red CI may hide other problems.
- After all subagents in a round return, review the combined `git diff` yourself for correctness and conflicts, and run the project's fast local checks (lint/typecheck/tests as applicable).

### 2e. Commit, push, resolve

- Commit the round's fixes. One commit per round is fine; use a message that summarizes what was addressed (e.g. `Address review findings: null check in X, race in Y; fix lint`).
- Push.
- For each finding that was fixed, reply briefly on its thread (e.g. "Fixed in <short sha>.") and resolve the thread.
- Update HEAD SHA and return to 2a.

## Exit condition

Stop only when **all** of the following hold for the latest pushed HEAD:

- Every required CI check is green (none pending, failed, cancelled, or unexpectedly skipped).
- The bot review pass for this HEAD has completed (or the wait window elapsed) and there are **no unresolved bot findings**.
- No uncommitted changes remain.

Then post a short summary to the user: PR URL, number of rounds, what was fixed, what was declined and why.

## Rules

- Never declare success on a pending, failed, or stale (older SHA) state.
- Cap at 8 fix rounds. If the loop is still not converging (e.g. the bot keeps raising the same or contradictory findings), stop and report the remaining items to the user instead of thrashing.
- Do not ask the user for confirmation except for destructive or genuinely ambiguous actions (force-push, rewriting history, changing PR base, closing threads from humans without a fix).
- Never force-push.
- If `gh` auth, permissions, or another external blocker prevents progress, report clearly and stop.
- Do not rewrite unrelated code or "improve" things the bots did not flag.
