## Arcade (arcade.school, `~/arcade.school`)

Never call the product "Playcademy Arcade" (or "Playcademy arcade") in anything you write. It is "the Arcade" or "arcade.school". Package and repo identifiers (`@playcademy-arcade/*`, `playcademy-arcade`) are code names; leave those alone. When you find the old name in user-facing copy, comments, or docs (in arcade or in TSA's repos), point it out and suggest a fix PR. Don't silently widen the current change to fix it.

For Arcade usage questions (who played, play sessions, DAU, sign-ins), always query the Arcade's own production database: `bun scripts/db query --stage production arcade "<sql>"` from an arcade checkout (e.g. `play_sessions`). Don't use the `mcp_arcade_school_*` tools for this; that database is TSA's, not the Arcade's.

The arcade repo ships its own skills in `.agents/skills/`. Always use them for the corresponding task instead of ad-hoc commands — they encode the team's Linear/GitHub conventions:

- `arcade-create-issue` — any Linear ticket (bug, feature, task). Always create the ticket first for new work.
- `arcade-consume-issue` — reading an issue and getting its Linear-generated branch name (use that branch name for the worktree).
- `arcade-create-pull-request` — opening PRs. The Slop Continuum rating is a title suffix (not a label): If the PR came out of back-and-forth with Nathan, ask him for the rating (except under "Run it", which self-rates; see below). If the work was autonomous/one-shot (e.g. `/ship` with no prior discussion), use **`(SC-10)`** without asking. You may only self-assign SC-9 or SC-10, never lower; a rating he states explicitly always wins. Keep the whole title under 70 characters and omit conventional-commit prefixes (`docs:`, `feat:`).
- `arcade-resolve-pr-feedback`, `arcade-hotfix`, `arcade-create-release`, `arcade-check-*` — for their respective tasks.
- `/ship <ARC-123 | spec> [SC-N]` (Pi extension `ship.ts` + local skill `~/.agents/skills/ship`) — straight-through autopilot (SC-10 by default, self-rated like "Run it"): issue → worktree → build → simplify → PR → CI/bot loop → merge to dev, no check-ins. It lives in dotfiles, not the repo.

Read the skill's `SKILL.md` before acting; follow its confirmation steps.

Linear: use the Arcade team in **superbuilders** at https://linear.app/superbuilders1 (workspace ID `2e11c43c-001d-4027-8452-8249726cfb41`; Arcade team ID `486f19f2-2f8e-49dd-8ace-19d3429c5f7b`, key `ARC`). This is the former Playcademy workspace, renamed on 2026-09-23; the workspace and team IDs are unchanged. Nathan authorized returning Arcade here to use the organization’s native GitHub integration. When authorizing Linear MCP, select **superbuilders**. Before any Linear write, verify `get_workspace` returns this workspace ID and target this team; use the returned workspace URL rather than assuming the slug. The separate https://linear.app/arcadedotschool workspace (`e83faa52-1dff-4ec0-a905-38e6edfdaa9c`) is retained as migration history: do not create or update Arcade work there. Reconnect or restart a stale Linear MCP client before writing.
