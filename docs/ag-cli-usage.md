Claude (anthropic-primary/claude-opus-5-5), assisting Nathan (routine ag-cli-usage):

# ag CLI usage — week ending Mon Nov 2 2026

Weekly audit by the `ag-cli-usage` routine (~/ag/routines/ag-cli-usage.md) from `ag usage --days 7`.
Intended surface: [docs/ag-cli.md](ag-cli.md).

## Adoption

| | this week | last week |
|---|---|---|
| adoption (ag calls ÷ ag + hand-rolled), old catalog | **83.9%** | 78.0% (codemode-inclusive prototype) |
| adoption, new catalog (baseline for next week) | 80.4% | — |
| shell calls (inside codemode) | 13,225 (13,104) | 5,534 bash-only + ~3.4k codemode |
| ag calls / hand-rolled (new catalog) | 475 / 116 | — |

Like for like: **+5.9 points**. `ag usage` now counts shell calls inside `codemode` (fix landed this week),
so this is the first week measured natively with them. No `ag-mux` or `tmux` calls at all this week
(sessions moved to T3); session operations are all through `ag`.

## Verbs

| verb | calls | sessions | error % |
|---|---|---|---|
| dev | 167 | 15 | 3% |
| write | 78 | 25 | 3% |
| discord | 53 | 11 | 2% |
| find | 27 | 16 | 4% |
| cua | 27 | 12 | 4% |
| read | 22 | 16 | 0% |
| link | 18 | 13 | 0% |
| gcal | 16 | 4 | 0% |
| sync | 14 | 6 | 0% |
| report | 8 | 4 | 0% |
| screen | 8 | 4 | 0% |
| me | 7 | 7 | 0% |
| send | 6 | 3 | 0% |
| ls | 5 | 4 | 0% |
| search | 4 | 4 | 0% |
| spawn | 4 | 3 | 25% |
| routine | 3 | 1 | 0% |
| peek | 2 | 2 | 0% |
| close | 1 | 1 | 0% |
| usage | 1 | 1 | 0% |
| status | 1 | 1 | 0% |
| host | 1 | 1 | 0% |

Only `spawn` is above 10% errors (1 of 4): `ag spawn -f - <<EOF` crashed with a traceback because `-f`
opens its argument as a file and doesn't treat `-` as stdin. Plain stdin (`ag spawn <<EOF`) works.

## Top hand-rolled gaps (new catalog, ≥ 5 calls)

| pattern | calls | sessions | covered by | diagnosis |
|---|---|---|---|---|
| client-ssh | 46 | 7 | none (build gap) | Legit client CLI work (debugging ag-client-cua on the client, YubiKey `ykman` over USB); 12 calls re-typed `export PATH=/opt/homebrew/bin:$PATH` because plain ssh has no login env. No `ag-mac run` twin for the client. |
| mac-ssh | 27 | 6 | `ag-mac run/push/pull` | Mostly what `ag-mac` can't do: SSH port forwards to ag-mac's Chrome CDP (9222) and the X OAuth callback (8080); the rest is scp and `ssh ag-mac 'zsh -lc "python3 -"' < script` that `ag-mac push`/`run` already cover. |
| transcript-grep (new) | 20 | 5 | `ag read --tools` (partly) | Digging the exact command an earlier session ran out of its .jsonl with `grep -o`/python. `ag read --tools` lists tool calls but can't filter, so agents grep. |
| find-session-grep | 9 | 5 | `ag find` | Searching transcripts for a phrase; part of this is audit work that needs file paths. |
| service-ctl / service-logs | 5 / 4 | 4 / 4 | `ag status/logs/restart` | Mostly MCP gateway and T3 work, where agents check `is-active` inline while editing. Low priority. |

## Changes this week

- `usage-patterns.json`: `mac-ssh` and `client-ssh` now also match a host at the end of a line
  or before a quote/paren (missed `ssh -fN -L … ag-mac` tunnels); new `transcript-grep` pattern.
- Spun out to an Inbox session: build `ag-client run/push/pull/status` (an `ag-mac` twin with the
  client's login env) and point the instructions at it. This is the top gap two weeks running.
- Not acted on yet (one finding per run): `ag spawn -f -` should read stdin; `ag-mac` has no
  port-forward subcommand (Chrome CDP 9222); `ag read --tools` has no filter.
