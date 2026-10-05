# ag CLI usage report

Weekly audit by the `ag-cli-usage` routine (`routines/ag-cli-usage.md`), from `ag usage --days 7`.
Background and the intended command surface: [ag-cli.md](ag-cli.md).

**Week ending 2026-10-05**: 564 Pi sessions, 26,204 bash calls.

**Adoption: 42.3%** with last week's pattern catalog (1,414 `ag <verb>` calls vs 1,931 hand-rolled), **up from 0.6%**.
With this week's tightened catalog (below) it reads **47.4%** (1,424 vs 1,581). The session and system verbs
landed on Oct 1; `ag` calls went from ~10/day to 100–490/day, and most hand-rolled patterns have nearly
stopped since Oct 2. What's left is concentrated in Sep 28–Oct 1 (before the verbs) plus three live gaps below.

## ag verbs (top 20)

| Verb | Calls | Sessions | Error % |
|---|---:|---:|---:|
| read | 219 | 120 | 3% |
| discord | 201 | 55 | 4% |
| sync | 182 | 66 | 8% |
| find | 162 | 105 | 9% |
| ls | 98 | 54 | 13% |
| close | 72 | 65 | 8% |
| send | 55 | 37 | 4% |
| link | 50 | 45 | 10% |
| peek | 49 | 33 | 8% |
| report | 43 | 31 | 2% |
| me | 40 | 36 | 8% |
| restart | 37 | 17 | 14% |
| cua | 33 | 17 | 3% |
| routine | 20 | 7 | 15% |
| spawn | 20 | 15 | 5% |
| status | 17 | 10 | 12% |
| logs | 12 | 9 | 8% |
| search | 10 | 10 | 0% |
| pin | 9 | 3 | 33% |
| merge | 6 | 4 | 0% |

Errors: **`peek`/`close`/`link`/`pin`/`rename`/`wait` reject bare tab/pane ids** (`ag close tVB`, `ag peek tCY`:
"no open session matches") because the resolver only maps the old `w1:tX` form; new opaque ids (what `ag ls`
itself prints, e.g. `t10F`) fall through. `restart` fails on the old name `ag-board` (now ag-dash).
`ls`/`find` errors were an `ag find` traceback (fixed mid-week) plus counter noise (unrelated output).

## Top hand-rolled gaps (≥ 15 calls)

| Pattern | Calls | Since Oct 3 | Covered by | Diagnosis |
|---|---:|---:|---|---|
| transcript-jq | 177 | 11 | `ag read` | Pre-verb; nearly gone. Rest is audit scripts reading many transcripts. |
| agents-build | 166 | 62 | `ag sync` | Legit: ag sessions editing agents.md sources; instructions say run `agents.md/build`. |
| pane-read | 131 | 51 | `ag peek` | Still live: reading own dev-process panes by id; `ag peek <pane>` rejects bare ids. |
| service-ctl | 128 | 32 | `ag status/restart` | Mostly installing/debugging launchd units on ag-mac; `ag restart ag-board` errored. |
| board-state | 118 | 25 | `ag ls --json` | Mostly ag-dash development (testing its API), not session lookup. |
| inbox-curl | 94 | 7 | `ag spawn` | Pre-verb; steered now. |
| self-lookup | 92 | 1 | `ag me` | Gone since Oct 2. |
| mux-snapshot | 83 | 30 | `ag ls` | Finding own watcher/dev tabs by label; `ag` verbs don't accept their ids. |
| report-back | 80 | 2 | `ag report` | Gone. |
| service-logs | 79 | 62 | `ag logs` | One session reading ag-dash-hotkeys.log while building it. |
| agent-prompt | 76 | 10 | `ag send` | Pre-verb; mostly steered. |
| manual-sync | 65 | 20 | `ag sync` | ag-personal and client repo repair over ssh; `ag sync personal` now exists. |
| tab-close | 54 | 19 | `ag close` | Closing own watcher tabs; `ag close tVB` failed (bare id), so agents fell back. |
| dev-tab (new) | 52 | 30 | none yet | Opening a labeled dev-process tab (watch-pr, dev server) with tab create + pane run. |
| tab-by-label | 48 | 16 | `ag ls` | Same as mux-snapshot: label → id for own dev tabs. |
| find-session-grep | 35 | 0 | `ag find` | Gone. |
| routine-state | 28 | 10 | `ag routine` | After narrowing: reading `<routine>.json` / list-timers by hand. |
| card-curl | 19 | 0 | `ag pin/wait` | Gone. |

## Changes this week

- Catalog: `routine-state` now only counts routine status files and `list-timers` (was 240 calls, ~90% a
  routine writing its own state dir); `service-ctl` and `service-logs` only count Ag units/logs; `pane-read`
  also counts `tmux -L ag capture-pane`; new `dev-tab` (`ag-mux tab create`).
- Spun out one fix: the resolver should accept bare opaque tab/pane ids (the ids `ag ls` prints), so
  `ag peek/close/link/pin/rename/wait` work on them; it underlies pane-read, tab-close, tab-by-label and
  mux-snapshot (~315 calls) and most `ag` verb errors.
- Not acted on (next candidates): no `ag` verb for dev-process tabs (open/run/read/close by label);
  `ag restart` could map the old `ag-board` name.
