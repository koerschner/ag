## Arcade (arcade.school, `~/arcade.school`)

Arcade-specific rules (legal ownership, naming, Linear workspace, the arcade skills) are in the user's private personal instructions (`~/AGENTS.md`).

Never call the product "Playcademy Arcade" (or "Playcademy arcade") in anything you write. It is "the Arcade" or "arcade.school". Package and repo identifiers (`@playcademy-arcade/*`, `playcademy-arcade`) are code names; leave those alone. When you find the old name in user-facing copy, comments, or docs, point it out and suggest a fix PR. Don't silently widen the current change to fix it.

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs. The Slop Continuum rating is a title suffix (not a label): If the PR came out of back-and-forth with the user, ask them for the rating (except under "Run it", which self-rates; see below). If the work was autonomous/one-shot (e.g. `/ship` with no prior discussion), use **`(SC-10)`** without asking. You may only self-assign SC-9 or SC-10, never lower; a rating they state explicitly always wins. Keep the whole title under 70 characters and omit conventional-commit prefixes (`docs:`, `feat:`).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.
- `/ship <ARC-123 | spec> [SC-N]` (Pi extension `ship.ts` + local skill `~/.agents/skills/ship`) — straight-through autopilot (SC-10 by default, self-rated like "Run it"): issue → worktree → build → simplify → PR → CI/bot loop → merge to dev, no check-ins. It lives in the ag repo, not arcade.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.
