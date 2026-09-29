## Waiting on long-running things (CI, deploys, builds, machines)

Never block on one long wait (`gh run watch`, `gh pr checks --watch`, `sleep`, `wait-output`) with a big timeout. Poll in short bounded checks instead: a non-blocking status query (`gh run view <id> --json status,conclusion,jobs`, `gh pr checks <pr> --json name,state,bucket`) every ~30–60s, each tool call capped at ~2 minutes (e.g. `timeout 90 gh run watch <id> --exit-status`, then re-check). Act the moment a job fails (read `--log-failed` and fix it immediately, don't wait for the rest of the run) or everything succeeds.

Never sit idle while CI runs. `sleep N` longer than ~60s is banned, including inside a poll loop. Between status checks, do the next useful thing:

- The next queued card or follow-up in the same task: start it in its own worktree off `origin/dev` (or stacked on the pending branch if it depends on it).
- Anything that doesn't depend on the CI result: review bot comments already posted, reply to/resolve threads, draft the PR description, file follow-up tickets, simplify, run local checks for the next change.
- Run slow local gates (pre-push hooks, `bun run check`) in a separate Herdr pane in the background and read the result later, instead of blocking your tool call on them.

Check back on the pending PR every few minutes between those steps. Only wait passively when there is truly nothing else to do, and say so.

### Wake-ups instead of waiting

When the wait is long (minutes to days) or open-ended, such as a machine coming back online, a slow deploy, a long job, or someone's reply, and you have nothing else useful to do, don't keep a turn open with sleeps or repeated polls. Set a wake-up and end your turn:

- Use the `tickler` tool with `when: "check"` and a cheap shell `check` that exits 0 once the thing is ready (e.g. `ssh -o ConnectTimeout=5 ag-client true`, `gh run view <id> --json status -q '.status=="completed"' | grep -q true`). The tickler's LaunchAgent runs it every minute without a model, so waiting costs no tokens or context.
- Use `when: "event"` when something else can tell you it's done: pass it the printed webhook (`curl -X POST http://ag:7373/tickler/<id>`, optional body = note) or have it run `tickler trigger <id>`.
- When it fires, it resumes **this** session in place if its pane is still open and ready; otherwise it opens a forked tab in the Inbox. After `expires` (default 7 days) it fires anyway and tells you the condition never came true.
- Use `when: "online"` only when Nathan himself is needed at his Mac. When the task just needs a machine reachable, use a `check` for that machine instead. Say in your reply what you're waiting for and how it will wake you.
