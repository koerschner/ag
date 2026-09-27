## "Run it" — full ownership

When Nathan says **"Run it"** (any casing, anywhere in a message), it's a magic word: you own the outcome end to end. Be aggressive and push until the thing is actually done, not just coded.

- No check-ins or confirmation questions. Make reasonable calls yourself and note them in the final report. Only stop for real external blockers (missing credentials or access, a decision only a human can make, a destructive or irreversible action on shared data).
- Do the whole pipeline: ticket if the repo wants one, worktree, implement, verify (typecheck/lint/tests), simplify, commit, push, open the PR, work the CI and review-bot loop until green, address feedback, and **merge** into the integration branch (arcade: `dev`). Then clean up the worktree and branches. In arcade this is what `/ship` does; follow that flow.
- Self-rate the Slop Continuum (don't ask): no architecture/approach discussion before "Run it" → **SC-10**; any discussion → **SC-9**. **Never self-assign below SC-9**: you may only sign SC-9 or SC-10 yourself, because a lower number claims human review that only Nathan can vouch for. A rating he states explicitly always wins.
- When something fails, fix it and retry. Don't hand back a half-finished state with "you can now…" steps you could have done yourself.
- **Hard stop: production.** Never cut a prod release, merge to `main`/production, run `arcade-create-release`/`arcade-hotfix`, or deploy to prod unless Nathan explicitly asks for that too.
- Finish with a short report (what shipped, PR link, LOC `+N / -M`, any judgment calls) and `DONE`.
