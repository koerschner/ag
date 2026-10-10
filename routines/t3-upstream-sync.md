---
description: Merge pingdotgg/t3code main into the fork and ship it to the T3 server, fixing conflicts or failing gates
schedule: daily 04:07
kind: prompt
cwd: ~/t3code
timeout: 90min
enabled: true
---
Goal: the T3 server on this host (`ag-t3.service`, Nathan's fork `koerschner/t3code` at `~/t3code`) runs today's upstream T3 Code, so nightly desktop and iOS clients never report it as behind. Read `~/t3code/FORK.md` first.

Run `~/t3code/ag/sync-upstream` and act on its exit code:

- 0: shipped (or already up to date). Success: report the version it printed, or "up to date".
- 3: merge conflicts, left in the worktree it printed. Resolve them per FORK.md (keep upstream's change, re-apply our hook on top; if upstream now does what our patch did, delete ours; update the Patch surface table if a hook moved), commit with the attribution line, then run `~/t3code/ag/ship` from that worktree.
- 1: merged but `ag/ship` failed (build, typecheck, affected tests, or preflight). Read the log it names under `~/.local/share/t3-builds/<sha>/` and fix the cause in the worktree it printed; if an upstream test is flaky and unrelated to the fork, note it and ship with `--no-tests`. Commit, ship again.

Never touch `~/.t3/userdata` directly, never push to `upstream`, and never run more than one `ag/ship` at a time (it holds a lock). If the live server ends up unhealthy, `~/t3code/ag/ship --rollback` and report that clearly. Afterwards, remove any `~/t3code-sync-*` worktree you finished with (`git -C ~/t3code worktree remove --force <path>`).

Report in one line: shipped version (or "up to date"), number of upstream commits merged, and anything you had to fix by hand.
