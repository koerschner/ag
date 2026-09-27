## Waiting on long-running things (CI, deploys, builds)

Never block on one long wait (`gh run watch`, `gh pr checks --watch`, `sleep`, `wait-output`) with a big timeout. Poll in short bounded checks instead: a non-blocking status query (`gh run view <id> --json status,conclusion,jobs`, `gh pr checks <pr> --json name,state,bucket`) every ~30–60s, each tool call capped at ~2 minutes (e.g. `timeout 90 gh run watch <id> --exit-status`, then re-check). Act the moment a job fails (read `--log-failed` and fix it immediately, don't wait for the rest of the run) or everything succeeds.

Never sit idle while CI runs. `sleep N` longer than ~60s is banned, including inside a poll loop. Between status checks, do the next useful thing:

- The next queued card or follow-up in the same task: start it in its own worktree off `origin/dev` (or stacked on the pending branch if it depends on it).
- Anything that doesn't depend on the CI result: review bot comments already posted, reply to/resolve threads, draft the PR description, file follow-up tickets, simplify, run local checks for the next change.
- Run slow local gates (pre-push hooks, `bun run check`) in a separate Herdr pane in the background and read the result later, instead of blocking your tool call on them.

Check back on the pending PR every few minutes between those steps. Only wait passively when there is truly nothing else to do, and say so.
