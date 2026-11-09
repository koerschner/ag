Claude (anthropic-primary/claude-opus-5-5), assisting Nathan (routine ag-cli-usage):

# ag CLI usage — week ending Mon Nov 9 2026

Weekly audit by the `ag-cli-usage` routine (~/ag/routines/ag-cli-usage.md) from `ag usage --days 7`.
Intended surface: [docs/ag-cli.md](ag-cli.md).

## Adoption

| | this week | last week |
|---|---|---|
| adoption (ag calls ÷ ag + hand-rolled), last week's catalog | **74.4%** | 80.4% |
| adoption, new catalog (baseline for next week) | 77.1% | — |
| shell calls (inside codemode) | 78,437 (78,190) | 13,225 (13,104) |
| sessions with shell calls | 4,749 | 2,661 |
| ag calls / hand-rolled (last week's catalog) | 396 / 136 | 475 / 116 |

Like for like: **−6.0 points**. Almost all of the drop is one session: "Build Hammerspoon Script"
(Nov 4–5) made 61 of this week's 71 raw `ssh`/`scp ag-mac` calls. Shell volume is ~6× last week's
and spread across many sessions (no single session above 353), yet ag calls fell slightly.
No `ag-mux` or `tmux` calls again; session operations all go through `ag`.

## Verbs

| verb | calls | sessions | error % |
|---|---|---|---|
| dev | 161 | 16 | 4% |
| write | 35 | 22 | 9% |
| screen | 34 | 5 | 0% |
| discord | 28 | 8 | 4% |
| find | 27 | 18 | 4% |
| read | 26 | 16 | 0% |
| cua | 21 | 12 | 5% |
| link | 16 | 13 | 6% |
| me / ls / sync | 7 / 7 / 7 | 6 / 7 / 6 | 0% |
| spawn / report / routine | 5 / 4 / 4 | 4 / 4 / 3 | 0% |
| search / usage / send / peek | 3 / 2 / 2 / 2 | 2 / 1 / 2 / 2 | 0% |
| mcp-gateway | 1 | 1 | 100% |
| mac, gcal, private, gmail-unsub | 1 each | 1 each | 0% |

`dev` and `write` errors are the commands they wrapped failing (a missing `knip` script, a Storybook
that didn't start) or codemode timeouts, not the verbs. `mcp-gateway` (1 of 1): `ag mcp-gateway --help`
doesn't print help; it hangs (reproduced; it ignores `timeout 8`), so the codemode call timed out.
`ag-mac …`/`ag-client …` calls aren't counted as the `mac`/`client` verbs (the counter only sees
`ag <verb>`), which understates adoption against `mac-ssh`/`client-ssh`.

## Top hand-rolled gaps (new catalog, ≥ 5 calls)

| pattern | calls | sessions | covered by | diagnosis |
|---|---|---|---|---|
| mac-ssh | 69 | 4 | `ag-mac push/pull/run` | **Bug drove it.** `ag-mac push /tmp/t.lua /tmp/t.lua` makes `/tmp/t.lua` a *directory* (it runs `mkdir -p` on the destination itself) and `push --help` shows rsync's help, so the agent fell back to `ssh ag-mac 'cat > f' < f` and scp for the rest of the session. `ag-client push` has the same bug. |
| routine-state | 12 | 9 | `ag routine show/log` | Mostly routines reading another routine's state file (vision-board, alpha-slack-watch) while doing their job. Low priority. |
| client-ssh | 8 | 2 | `ag-client push/run` | scp to the client for Hammerspoon tests, same push bug. Down from 46: `ag-client` landed. |
| transcript-grep | 7 | 3 | `ag read --tools` (partly) | `grep -o` over one session file for an exact earlier command; `ag read` has no filter. |
| service-logs | 6 | 3 | `ag logs` | `journalctl -u ag-t3 \| grep` while debugging T3 pairing; `ag logs` has no `--since`/grep. |
| transcript-jq / inbox-curl | 5 / 5 | 4 / 5 | `ag read` / `ag spawn` | inbox-curl is all routine prompts still using the curl recipe; `ag spawn` exists. |

## Changes this week

- `usage-patterns.json`: `find-session-grep` now matches only `grep -l` over `~/.pi/agent/sessions`
  (17 of its 19 hits were grep -l over routine `.jsonl` files); `mac-ssh`/`client-ssh` skip an
  `ssh` right after a quote, `|` or backslash (grep patterns in docs and audit scripts, 2 calls).
- Spun out to an Inbox session: fix `ag-mac push`/`ag-client push` to an exact file path and give
  push/pull their own `--help`.
- Not acted on yet (one finding per run): `ag mcp-gateway --help` hangs; count `ag-mac`/`ag-client`
  as verbs in `ag usage`; routine prompts still curl the ag-inbox instead of `ag spawn`.
