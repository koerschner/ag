---
name: autoreview
description: "Run a Pi-based structured code review as a closeout check on local, branch, PR, or commit changes before commit or ship."
---

# Auto Review

Run a structured code review using **Pi**. Do not use Codex, Claude Code, `codex review`, Claude harnesses, the old bundled `autoreview` helper, or nested reviewer panels that invoke non-Pi CLIs. Pi may use any configured model/provider that is appropriate for the task.

Use when:

- user asks for autoreview / second-model review / code review closeout
- after non-trivial code edits, before final/commit/ship
- reviewing a local branch or PR branch after fixes

## Contract

- Always run the review through `pi`.
- Never invoke Codex/Claude harnesses or built-in `codex review`.
- Treat review output as advisory. Never blindly apply it.
- Verify every finding by reading the real code path and adjacent files.
- Read dependency docs/source/types when the finding depends on external behavior.
- Reject unrealistic edge cases, speculative risks, broad rewrites, and fixes that over-complicate the codebase.
- Prefer small fixes at the right ownership boundary; no refactor unless it clearly improves the bug class.
- When an accepted finding shows a bug class or repeated pattern, inspect the current PR scope for sibling instances before fixing.
- Fix the scoped bug class at once when practical; stop at touched surfaces, owner boundaries, and clear follow-up territory.
- If a review-triggered fix changes code, rerun focused tests and rerun the Pi review.
- Keep going until the Pi review returns no accepted/actionable findings, or until every remaining finding has been consciously rejected with evidence.
- Security perspective is always included, but should not cripple legitimate functionality. Report security findings only when the change creates a concrete, actionable risk or removes an important safety check.
- Do not push just to review. Push only when the user requested push/ship/PR update.

## Pick Target

Dirty local work:

```bash
pi --no-session --tools read,bash -p "$(cat <<'PROMPT'
You are performing a structured code review of the current repository's uncommitted local changes.
Use only read-only inspection. Do not modify files. Inspect `git status --short`, `git diff --stat`, `git diff`, and any relevant adjacent files/tests.
Focus on concrete correctness, regression, security, data-loss, API compatibility, and test-gap issues introduced by this patch.
Return:
1. Findings: severity, file/line, issue, why it matters, minimal fix.
2. If no findings, exactly: autoreview clean: no accepted/actionable findings reported
PROMPT
)"
```

Branch/PR work:

```bash
base=origin/main
pi --no-session --tools read,bash -p "$(cat <<PROMPT
You are performing a structured code review of this branch against ${base}.
Use only read-only inspection. Do not modify files. Inspect `git diff --stat ${base}...HEAD`, `git diff ${base}...HEAD`, and relevant adjacent files/tests.
Focus on concrete correctness, regression, security, data-loss, API compatibility, and test-gap issues introduced by this branch.
Return:
1. Findings: severity, file/line, issue, why it matters, minimal fix.
2. If no findings, exactly: autoreview clean: no accepted/actionable findings reported
PROMPT
)"
```

If an open PR exists, use its actual base:

```bash
base=$(gh pr view --json baseRefName --jq .baseRefName)
base="origin/$base"
pi --no-session --tools read,bash -p "Review this branch against ${base}; inspect git diff ${base}...HEAD and relevant files. Return actionable findings only, or exactly: autoreview clean: no accepted/actionable findings reported"
```

Committed single change:

```bash
commit=HEAD
pi --no-session --tools read,bash -p "Review commit ${commit}. Use read-only inspection of `git show --stat ${commit}`, `git show ${commit}`, and relevant adjacent files/tests. Return actionable findings only, or exactly: autoreview clean: no accepted/actionable findings reported"
```

## Model Choice

Pi is the review harness. You may choose any configured Pi model/provider with `--model` when useful, for example:

```bash
pi --model sonnet:high --no-session --tools read,bash -p "Review the local uncommitted diff..."
pi --model openai/gpt-5.1 --thinking high --no-session --tools read,bash -p "Review the branch diff..."
```

Do not switch to non-Pi CLIs. If a chosen Pi model fails due to capacity, retry Pi with the same model a few times. If unavailable, use another Pi model and report the fallback.

## Parallel Closeout

Run formatting first if it can change line locations. Then it is OK to run focused tests and Pi review in parallel manually, for example in separate tmux panes/windows, or sequentially if simpler.

Focused tests example:

```bash
cd apps/backend && .venv/bin/python -m pytest tests/test_chart_routes.py tests/test_agent_tools.py -q
```

If tests or review lead to code edits, rerun the affected tests and rerun Pi review until clean or consciously rejected.

## Verification Loop

For each Pi finding:

1. Read the referenced code and adjacent ownership boundary.
2. Confirm the finding is real and introduced by the reviewed change.
3. Apply the smallest appropriate fix if accepted.
4. Search for sibling instances in the touched scope.
5. Rerun focused tests.
6. Rerun Pi review.

Reject a finding only when evidence shows it is intentional, not introduced, speculative, or not worth the complexity. Add a code comment only when it documents a real invariant future reviewers should know.

## Final Report

Include:

- Pi review command used, including model if specified
- tests/proof run
- findings accepted/rejected, briefly why
- the clean Pi review result, or why any remaining finding was consciously rejected

Do not run another review solely to improve final wording. If the final Pi review says `autoreview clean: no accepted/actionable findings reported`, report that exact run as clean.
