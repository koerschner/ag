## Waiting on long-running things (CI, deploys, builds, machines)

Never block on one long wait (`gh run watch`, `gh pr checks --watch`, `sleep`, `wait-output`) with a big timeout. Poll in short bounded checks instead: a non-blocking status query (`gh run view <id> --json status,conclusion,jobs`, `gh pr checks <pr> --json name,state,bucket`) every ~30–60s, each tool call capped at ~2 minutes (e.g. `timeout 90 gh run watch <id> --exit-status`, then re-check). Act the moment a job fails (read `--log-failed` and fix it immediately, don't wait for the rest of the run) or everything succeeds.

**After you push, keep polling CI in the same turn.** Check the PR's checks and review-bot threads every ~30–60s and report progress as it comes in, until everything is green and the bots have posted; fix failures and findings as they land. Don't end the turn or hand off to a scheduled wake-up while CI is still running. Use a wake-up only when what's left waits on a human (an approval) or will clearly take far longer than the run (e.g. a nightly job).

Never sit idle while CI runs. `sleep N` longer than ~60s is banned, including inside a poll loop. Between status checks, do the next useful thing:

- The next queued card or follow-up in the same task: start it in its own worktree off the integration branch (arcade: `origin/main`) (or stacked on the pending branch if it depends on it).
- Anything that doesn't depend on the CI result: review bot comments already posted, reply to/resolve threads, draft the PR description, file follow-up tickets, simplify, run local checks for the next change.
- Run slow local gates (pre-push hooks, `bun run check`) in a separate tmux pane in the background and read the result later, instead of blocking your tool call on them.

Check back on the pending PR every few minutes between those steps. Only wait passively when there is truly nothing else to do, and say so.

### Wake-ups instead of waiting

When the wait is long (minutes to days) or open-ended, such as a machine coming back online, a slow deploy, a long job, or someone's reply, and you have nothing else useful to do, don't keep a turn open with sleeps or repeated polls. Set a wake-up and end your turn:

- Use T3's `schedule_task` with `{type: "once", runAt}` bound to this thread, at the time it's worth re-checking. When it fires, check; if it isn't ready, schedule the next one with a longer gap, and give up (tell the user) after a sensible deadline.
- Use `{type: "webhook"}` when something else can tell you it's done: hand it the returned `webhookUrl`.
- Say in your reply what you're waiting for and when it will wake you.
