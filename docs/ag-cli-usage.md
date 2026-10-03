# ag CLI usage report

Weekly audit by the `ag-cli-usage` routine (`routines/ag-cli-usage.md`), from `ag usage --days 7`.
Background and the intended command surface: [ag-cli.md](ag-cli.md).

**Week ending 2026-10-01** (first run, no previous week to compare): 368 Pi sessions, 19,124 bash calls.

**Adoption: 0.6%** (20 `ag <verb>` calls vs 3,198 hand-rolled equivalents). Last week: n/a.
With last week's pattern catalog it would read 0.8%; the drop is only the three new patterns below.
Expected: the session verbs (`me ls find read peek link spawn report send merge pin wait file rename close`)
and system verbs (`sync status logs restart`) aren't built yet; a build session is on it.

## ag verbs

| Verb | Calls | Sessions | Error % |
|---|---:|---:|---:|
| board | 9 | 5 | 0% |
| inbox | 5 | 2 | 40%* |
| usage | 4 | 2 | 25%* |
| routine | 2 | 1 | 0% |

\* Not real failures. The `inbox` "calls" are the phrase "ag inbox" at the start of a line inside
multi-line `git commit -m "…"` messages and python strings (README edits), and their errors are unrelated
(`git push` upstream mismatch, a stale pre-commit AGENTS.md, a python assert). `AG_CALL` in `lib/ag/usage`
strips heredocs but not multi-line quoted strings; at this volume it's noise, so not fixed this run.

## Top hand-rolled gaps

| Pattern | Calls / sessions | Err % | Verb | Diagnosis |
|---|---:|---:|---|---|
| pane-read (`pane`/`agent read`) | 537 / 125 | 9% | `peek` | verb not built yet (build gap) |
| service-ctl (systemctl/launchctl) | 304 / 82 | 16% | `status`/`restart` | not built; many hits are legit dev work on services |
| old-link-helper | 285 / 115 | 11% | `link` | not built; AGENTS.md still told agents to use the old link helper |
| agent-prompt | 266 / 89 | 15% | `send` | not built; stale pane ids → `agent_not_found` |
| self-lookup (`pane list` + jq) | 257 / 104 | 9% | `me` | not built; AGENTS.md "Split out" recipe teaches it |
| mux-snapshot (`api snapshot`/`workspace list`) | 179 / 59 | 8% | `ls` | not built (new pattern) |
| transcript-jq | 172 / 72 | 12% | `read` | not built |
| tab-by-label | 161 / 77 | 16% | `ls` | not built |
| agent-status (`agent`/`pane get`) | 161 / 49 | 12% | `ls` | not built (new pattern) |
| tab-close | 126 / 74 | 10% | `close` | not built; "Defer-only sessions" rule taught the raw `tab close` |
| inbox-curl | 121 / 48 | 19% | `spawn` | not built; forgotten text/plain header → `empty` |
| agents-build | 103 / 53 | 18% | `sync` | not built |
| stale-self-env (tab-id env var) | 91 / 59 | 5% | `me` | not built |
| board-state (`:7376/api/state`) | 81 / 19 | 7% | `ls` | not built |
| report-back | 71 / 38 | 8% | `report` | not built |
| tab-create-start | 63 / 30 | 22% | `spawn` | not built |
| service-logs | 55 / 15 | 9% | `logs` | not built |
| manual-sync (ssh … git pull) | 40 / 10 | 15% | `sync` | not built |
| find-session-grep | 36 / 23 | 8% | `find` | not built |
| routine-state | 23 / 8 | 0% | `routine` | verb exists; hits are mostly the routine runner's own tests of state files |
| tab-rename | 20 / 16 | 10% | `rename` | not built |
| card-curl | 18 / 10 | 6% | `pin`/`wait` | not built |
| tab-move | 18 / 6 | 6% | `file` | not built |

Caveat: some matches are this week's audit scripts themselves (python holding the regexes as strings),
which inflates each row by a few calls.

## Changes this week

- First run; baseline recorded.
- `usage-patterns.json`: `pane-read` now also matches `agent read`; new patterns `agent-status`
  (`agent`/`pane get` → `ls`), `mux-snapshot` (`api snapshot`/`workspace list` → `ls`) and the old link helper
  (→ `link`), found by skimming uncatalogued ag-mux/curl/ssh calls.
- Nothing spun out: the top finding (`peek`, and every other gap) is covered by the "ag CLI Build" session
  spun out earlier today (http://ag:7376/01a0f5ca-2434-75db-bad6-bce2dc5f80c0), which builds every verb in
  ag-cli.md and then replaces the old recipes in AGENTS.md.
