---
description: Weekly audit of how agents use the ag CLI; reports adoption and the biggest hand-rolled gaps
schedule: weekly Mon 09:07
kind: prompt
cwd: ~
timeout: 60min
enabled: true
---
Goal: agents should do Ag operations (find/read/prompt/spin out/merge/close sessions, pin and waiting,
syncing machines, services) through the `ag` CLI instead of hand-rolling them with ag-mux + jq, curl to
AG Dash or the inbox, or jq over transcripts. Background and the intended command surface: ~/ag/docs/ag-cli.md.

1. Measure: `ag usage --days 7 --json > ~/.local/state/routines/ag-cli-usage/usage-$(date +%Y%m%d).json`, and read
   the previous week's file next to it (if any) for the trend.
2. Judge each hand-rolled pattern with ≥ 15 calls this week:
   - its `ag` verb exists (`ag help`) → agents aren't being steered to it. Find why from a few example calls'
     sessions (instructions still show the old recipe? the verb lacks an option they needed? it errors?).
   - its verb doesn't exist yet → it's a build gap.
   Also judge each `ag` verb with an error rate above 10%: read a few failing calls and say what broke.
   Look for recurring Ag operations that the catalog misses (skim a sample of this week's ag-mux/curl/ssh
   calls); add a regex for each to usage-patterns.json.
3. Write the report to ~/ag/docs/ag-cli-usage.md (replace the whole file): date, adoption % this week vs last,
   a table of verbs (calls, sessions, error %), a table of the top hand-rolled gaps with the verb that covers them
   and your one-line diagnosis, and a short "Changes this week" list. Keep it under ~80 lines.
4. Ship: do steps 2–3's file edits in a fresh worktree (`git -C ~/ag fetch -q origin && git -C ~/ag worktree add
   ~/ag-routine-usage -b routine/ag-cli-usage origin/main`), commit only docs/ag-cli-usage.md and
   bin/dot-local/lib/ag/usage-patterns.json, push to main (pull --rebase and retry on a race), remove the worktree
   and branch, then `git -C ~/ag pull -q --rebase --autostash`.
5. Act on at most ONE finding per run, the one with the most calls: spin out a single Inbox session (POST the
   self-contained prompt to `http://ag:7373/prompt?new=1` with `content-type: text/plain`, or `ag spawn` once it
   exists) to fix it: build the missing verb, fix the failing one, or replace the old recipe in ~/ag/agents.md/
   with the `ag` command (then `agents.md/build`). Skip this if the same finding was spun out in the last 14 days
   (keep a list in ~/.local/state/routines/ag-cli-usage/spun-out.json: finding, date, tab). Nathan's standing
   rule: ag repo changes are slop-cannon (commit and push to main without asking).

RESULT summary: "adoption X% (±Y), top gap: <pattern> N calls; <spun out | nothing spun out>".
