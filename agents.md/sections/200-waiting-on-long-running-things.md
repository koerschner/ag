## Waiting on long-running things (CI, deploys, builds, machines)

- Poll in short bounded checks (a non-blocking status query every ~30–60s, each call capped at ~2 minutes), never one long `--watch` or `sleep`. `sleep` over ~60s is banned, even inside a loop.
- After you push, keep polling CI and review bots in the same turn until everything is green; act on a failure the moment it lands (`gh run view <id> --log-failed`).
- Between checks, do the next useful thing that doesn't depend on the result instead of idling.
- For long or open-ended waits (a person, a slow deploy, a machine coming back), schedule a wake-up with T3's `schedule_task` (`{type: "once", runAt}`, bound to this thread), say what you're waiting for and when it fires, and end the turn. When it fires and things aren't ready, back off and reschedule. Nothing waits silently.
- Never follow up with other people on the user's behalf without his OK; draft it for him instead.
