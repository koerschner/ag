---
name: quick-review
description: "Fast multi-model code review for quick/casual checks of local diffs, staged changes, latest commits, branches, PRs, or specific files. Use this whenever the user asks for a quick review, light review, sanity check, scan for obvious issues, or asks simply to review code without saying deep/thorough/rigorous. Uses faster models in parallel and returns only validated high-signal findings. For exhaustive pre-merge confidence, use deep-review instead."
argument-hint: "[target or extra review instructions]"
---

# Quick Review

Use this skill for a fast, high-signal code review. The goal is to catch obvious correctness, security, test, accessibility, and maintainability problems without the expense or latency of the deep-review skill.

## Core principle

Move quickly, but avoid noisy drive-by comments. Do not dump a large review packet into small/fast models. First have the orchestrating agent inspect the diff and derive targeted review questions, then send each quick reviewer a focused slice of context and questions. The orchestrator synthesizes only findings that look real from the diff/context.

## Accepted inputs

The user may provide:

- A PR URL
- `owner/repo#number`
- A branch name
- A commit SHA
- File paths
- Extra review instructions
- No explicit scope, in which case infer the best available diff

## Determine scope

Determine review scope in this priority order:

1. Explicit user scope:
   - PR URL
   - `owner/repo#number`
   - branch name
   - commit SHA
   - file paths
2. Current feature branch diff vs main:
   - `git diff main...HEAD`
3. Staged changes:
   - `git diff --staged`
4. Latest commit:
   - `git show --stat --patch HEAD`

For a PR, use `gh` to fetch PR context when available. If `gh` is unavailable or unauthenticated, fall back to git commands and state the limitation.

## Orchestrator triage before spawning reviewers

The main agent should be the smart orchestrator. Before spawning quick reviewers:

1. Inspect the changed file list/stat and the diff enough to understand shape and risk.
2. Identify 3-8 targeted review questions, such as:
   - What new behavior or invariant is most likely to be wrong?
   - Are there auth/security/input-validation paths touched by this diff?
   - Are there migrations, indexes, API/schema compatibility risks, or destructive operations?
   - Which tests should prove the changed behavior, and do they?
   - Are there changed error-handling paths that silently degrade instead of failing fast?
3. Partition questions by reviewer strength and context size. Prefer small, concrete prompts over a single giant dump.
4. Include only the relevant diff snippets, nearby code, tests, schemas, or PR text needed for each question.

Quick review should not crawl the entire repo unless a targeted question clearly requires it. The orchestration work matters because smaller models do better when asked specific questions with bounded context.

## Fast reviewer sub-agents

Spawn these quick reviewers in parallel in a single `subagent` batch. Give each reviewer targeted questions and focused context; do not blindly pass the whole review packet unless the diff is tiny:

1. `pr-review-claude-haiku` — Claude Haiku, low thinking
2. `pr-review-gpt-mini` — GPT mini, low thinking
3. `pr-review-gemini-flash` — Gemini Flash, low thinking

Use `agentScope: "user"` unless the user explicitly wants project-local agents too.

Example tool shape:

```json
{
  "agentScope": "user",
  "tasks": [
    { "agent": "pr-review-claude-haiku", "task": "<targeted review questions and focused context for Claude>", "cwd": "<repo root>" },
    { "agent": "pr-review-gpt-mini", "task": "<targeted review questions and focused context for GPT mini>", "cwd": "<repo root>" },
    { "agent": "pr-review-gemini-flash", "task": "<targeted review questions and focused context for Gemini Flash>", "cwd": "<repo root>" }
  ]
}
```

If one model is unavailable, say so and continue with the others. If all fail, ask whether to retry or switch to deep-review.

Run the reviewers concurrently, not sequentially.

## Reviewer objective

Each reviewer prompt should ask it to:

- Answer the targeted review questions first.
- Independently review only the provided focused scope, asking for more context only if necessary.
- Prioritize real bugs over style comments.
- Focus on correctness, security, error handling, tests, accessibility, performance, and maintainability.
- Rank findings as `high`, `medium`, or `low`.
- Include file/line or diff evidence.
- Avoid speculative findings.
- Keep the report concise.

## Synthesis pass

After the quick reviewers return:

1. Inspect the cited files/diff enough to validate each plausible finding.
2. Drop likely false positives and pure style preferences.
3. Merge duplicate findings.
4. Prefer findings raised by multiple reviewers, but keep a unique finding if it is clearly real.

## Report format

Return concise Markdown:

```markdown
# Quick Review Report

## Summary
- Scope reviewed: ...
- Reviewers: Claude Haiku, GPT mini, Gemini Flash (note failures if any)
- Overall recommendation: approve / fix issues below / consider deep-review

## Findings

### [high|medium|low] Title
- **Evidence:** file/line/diff reference
- **Why it matters:** ...
- **Suggested direction:** ...

## Notes
- Mention important limitations, skipped context, or why a deep-review may be warranted.
```

## Recommendation policy

- Recommend **fix issues below** if any validated high finding remains.
- Recommend **consider deep-review** when the change is large, security-sensitive, migration-heavy, or product/spec fidelity is unclear.
- Recommend **approve** only when no high issues remain and the reviewed scope was adequate.

Only implement fixes after the user asks for them.
