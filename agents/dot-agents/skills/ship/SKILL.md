---
name: ship
description: Straight-through SC-10 autopilot for the arcade repo — Linear issue or spec → worktree → build → simplify → PR → CI and review-bot loop → merge to dev, with no check-ins. Driven by the Pi `/ship` command; do not invoke on your own.
disable-model-invocation: true
argument-hint: <ARC-123 | Linear URL | "one-paragraph spec"> [SC-N]
---

# Ship

Take one piece of arcade work from kickoff to merged on `dev` without stopping. The kickoff (`/ship …`) is the only approval: it pre-approves every confirmation stop in the team skills this drives, including commits, pushes, the PR draft, the feedback plan, and the merge. Keep the team skills' **conventions**; skip their **stops**.

Stop early only when you genuinely cannot proceed (see [Blocked](#blocked)).

## Kickoff

Parse the argument:

- `ARC-123` or a Linear URL: an existing issue.
- Free text: a spec. Create the issue from it.
- `SC-N` anywhere: the PR's Slop Continuum rating. Default **SC-10**.

Empty argument: ask for the issue or spec and stop.

State in one line what you're shipping and where, then go.

## 1. Issue and worktree

- Spec: run `arcade-create-issue` and create the issue without waiting (priority from context, default Medium).
- Run `arcade-consume-issue`, take Linear's branch name, and claim the issue (`assignee: "me"`, `state: "In Progress"`).
- Already `Done`/`Canceled`, or someone else has an open PR for it: stop as **already done**.
- Create a sibling worktree off `origin/dev` (see the harness's worktree convention). Never build in `~/arcade.school` itself.

## 2. Build

- Read enough to know exactly which files change. Smallest diff that closes the issue; reuse the domain's existing patterns; nothing extra.
- Open questions (naming, defaults, edge cases): pick what fits the surrounding code and note it for the PR's "Judgment calls" section. Don't ask.
- Add or extend tests where the domain already has them.
- Run the local gate (`bun run check`, the relevant `vitest` project), then commit in coherent steps. Never `--no-verify`.
- If the pre-push hook fails only because Docker isn't running (Stripe seam tests), push with `SKIP_TESTS=true git push`; CI runs the full suite.

## 3. Simplify

Apply the `simplify` skill to what you touched, keep behavior identical, re-run the gate, commit.

## 4. Pull request

Follow `arcade-create-pull-request` for the title and body (Summary, How to Test, Risk, Issue Link `Closes ARC-…`), but create it without showing a draft.

- Title ends with the rating, `(SC-10)` by default, under 70 characters.
- Add `## Judgment calls` if you made any.
- Base `dev`, not a draft.
- The body opens with the attribution line required for messages written on Nathan's behalf.

## 5. CI and review-bot loop

Loop on the latest pushed HEAD. Ignore anything tied to older SHAs.

1. `gh pr checks <pr> --watch`. On failure, run `gh run view <id> --log-failed` and fix it. One rerun (`gh run rerun --failed`) for a clearly unrelated flake.
2. After CI, give the review bots (Cursor Bugbot, Greptile, Qodo, cubic, Copilot) up to ~10 minutes, polling each minute.
3. Triage their findings with `arcade-resolve-pr-feedback` (its query and dedup rules), with no plan stop:
    - **Fix** real bugs and reasonable improvements (the default). Reply "Fixed in <sha>." and resolve the thread.
    - **Decline** confident false positives or out-of-scope asks with a one- or two-sentence reply, then resolve.
    - Findings that would change product direction: make the conservative call, decline or fix minimally, and flag it in the final report. Don't stop.
4. Gate, commit, push, repeat.

Exit when every required check is green on HEAD and no bot findings are unresolved. Cap at **6 rounds**; after that, merge anyway if CI is green and list the leftover findings in the report. If `dev` moved and conflicts appear, rebase onto `origin/dev` and `--force-with-lease` your own branch.

## 6. Merge

```bash
gh pr merge <pr> --squash --delete-branch --match-head-commit <sha>
```

If the only blocker is a required review, retry with `--admin`. Ignore a local "dev is already used by worktree" error from `gh`; check `gh pr view <pr> --json state`.

## 7. Cleanup and report

- Confirm it's merged, and that Linear closed the issue (set it to Done yourself if not).
- Remove the worktree and local branch. If the remote branch survived and `git push --delete` trips the pre-push hook, run `gh api -X DELETE repos/superbuilders/arcade.school/git/refs/heads/<branch>`. Close the worktree's Herdr workspace if you created it.
- Call `ship_done({ pr, summary })`. The summary covers the PR URL, merged SHA, net LOC (`git diff --shortstat` of the merge), CI/bot rounds, what was fixed or declined, judgment calls, and anything worth eyeballing on staging.

The `dev → main` release isn't part of this.

## Blocked

Call `ship_halt({ reason, summary })` only when you can't move forward:

- **already_done**: the issue is closed, or someone else already has a PR for it.
- **blocked**: an external blocker you can't fix, such as auth or permissions, a merge refused for something other than a required review, or CI that stays red after honest attempts.

Before halting, push everything you have and list exactly what's left.
