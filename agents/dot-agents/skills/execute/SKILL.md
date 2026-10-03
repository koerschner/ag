---
name: execute
description: Look at the todo list, choose the next most appropriate actionable todo, execute exactly one todo, then stop and report back on what was done. After the work, reconcile the todo list so related todos reflect reality. Use this whenever the user wants you to pick the next task from todos and make progress without manually selecting one first.
argument-hint: "[optional: focus area, constraints, or selection hints]"
allowed-tools: todo, read, bash, edit, write
---

# Execute

Choose one todo, do it, and stop.

The point of this skill is to convert a backlog into the single best next action without trying to clear the whole queue. Be decisive, but stay grounded in the actual repo state and the todo metadata.

## Inputs

Treat `$ARGUMENTS` as optional guidance that can influence selection, for example:
- a focus area
- constraints like "quick win" or "highest impact"
- hints about what to avoid

If no arguments are provided, infer the next best todo from the todo list and current project context.

## Selection process

1. List current todos.
2. Ignore todos that are clearly done, blocked, not actionable, or already claimed by another active session.
3. Prefer the todo that is most appropriate **right now**, balancing:
   - explicit priority or urgency in the title/body/status
   - dependency order
   - whether it is currently actionable from the available files/context
   - user-provided focus hints in `$ARGUMENTS`
   - highest leverage / unblocking impact
   - smallest meaningful step only when priorities are otherwise unclear
4. If two candidates are close, prefer the one you can complete confidently in this session.
5. If no todo is actionable, stop and explain why instead of inventing work.

## Before doing the work

- Claim the selected todo so other sessions do not race on it.
- Read the todo body carefully.
- Inspect the relevant files before editing anything.
- Make a short plan for this one todo only.

## Execution rules

- Execute **exactly one** todo.
- Do not chain into the next todo, even if the next step feels obvious.
- Keep changes scoped to what is necessary to complete the chosen todo.
- If the todo turns out to be ambiguous or blocked by missing information, do the maximum safe progress you can, then report the blocker.

## Reconciling todos after the work

After executing the chosen todo, do a short wrap-up pass on the todo system before stopping.

1. Re-check the relevant todo list, not just the selected item.
2. Compare the completed work against related todos.
3. Mutate todos so they reflect reality:
   - mark the selected todo done if it is actually complete
   - leave it in progress or open with a concise progress note if only partially complete
   - update other affected todos if this work unblocked them, partially satisfied them, made them obsolete, or revealed a more accurate next action
   - split or clarify overly broad todos when only part of the work is now done
   - add a new todo only if the work clearly uncovered a concrete follow-up
4. Release claims when appropriate.

This is a **todo reconciliation** pass, not permission to execute more work. You are still only allowed to perform one todo's implementation work. The goal is to leave the todo list cleaner, more truthful, and better sequenced based on what just happened.

## Git commit

After finishing the implementation work and reconciling todos, create a git commit before giving the final response.

1. Review the working tree so you understand what will be committed.
2. Stage only the files that belong to the single executed todo and its todo reconciliation updates.
3. Create one commit with a concise message that references the todo id or summary.
4. If there are no code or todo changes to commit, say so explicitly in the final response instead of forcing an empty commit.
5. If a commit cannot be made safely, explain why in the final response.

Do not use the commit as an excuse to bundle unrelated work. The commit should reflect exactly the one todo you executed.

## Final response

Stop after this one todo and report:
- which todo you selected and why
- what you changed
- file paths touched
- how you reconciled the todo list afterward
- current status of the selected todo
- the git commit hash and message, or why no commit was made
- any other todos you closed, updated, split, or created
- any follow-up or blocker for the user

Do not continue to another todo unless the user explicitly asks you to run `/execute` again.
