# `ag` CLI: audit and proposed surface

Audit date: 2026-10-01. Source: every Pi session started since 2026-09-17 on the session host (664 sessions,
34,314 tool calls, 28,612 of them `bash`). Counts are `calls / sessions`. Script: patterns over the extracted
`bash` commands plus their tool results (error column = result contained an error / `not found` / `empty`).

Today `ag` only attaches a terminal to the session host (`bin/dot-local/bin/ag`). Everything else agents do
to Ag is hand-rolled `ag-mux` (or the old multiplexer CLI) + `jq`, `curl` to ag-dash or the inbox, or `jq`/`python` over session
`.jsonl` files, re-derived from AGENTS.md prose each time.

## What agents actually do by hand

| Workflow | Calls / sessions | Err | How it's done today |
|---|---|---|---|
| Read other sessions' screens | 549 / 136 | | `ag-mux pane list \| jq` for the pane, then `pane read --source recent-unwrapped` |
| Read a session transcript | 260 / 96 (733 / 186 incl. any grep over `.jsonl`) | 14% | `jq 'select(.message.role=="user")…'` or python, after finding the file |
| Find a tab by label | 417 / 145 | | `tab list \| jq '.label'` |
| Find *my own* pane/tab ("who am I") | 251 / 101 | 10% | `pane list \| jq --arg f "$PI_SESSION_FILE"`; 69 / 50 more trusted a possibly stale tab-id env var |
| Commit + push ag/dotfiles | 373 / 153 | | manual; then `ssh ag-client/ag-mac 'git pull && stow … && hs reload'` per machine |
| Spin out / split out (inbox) | 370 / 68 | 18% | heredoc → `curl -H content-type:text/plain --data-binary @f 'http://ag:7373/prompt?new=1'`; forgotten header → `empty` |
| Prompt another session | 272 / 92 | 15% | resolve pane, `agent prompt`; stale pane ids → `agent_not_found` |
| ag-dash API (state, card, transcript, new, close) | 327 / 55 | 8% | `curl :7376/api/state \| jq`; pin = `POST /api/card {"tab","pinned":true}` after a self-lookup |
| launchctl / systemctl / journalctl / log tails | 368+76+191 | | per-service, per-machine incantations |
| `agents.md/build` | 99 / 51 | | separate step before every ag commit |
| Tab create + agent start | 88+68 / 44 | 8% | two calls plus JSON parsing |
| Tab close (incl. self-close) | 136 / 81 | | `tab close $(self lookup)`, sometimes `nohup sleep 25; tab close` |
| Merge sessions | 29 / 15 | | hand-built `merged-into` + `session_info` JSONL with `jq -nc`, then close |
| Find "the session where I was doing X" | 46 / 28 grep -l, 69 / 16 api/state, 15 tab-find | | ad hoc; the user asked "find that session" in ~20 prompts |

The user's own prompts (same window) ask for these Ag-level actions: put in waiting 81, defer/ag-tickler 44,
merge 31, close tab 25, give me the link 22, pin (then "hotpath") 21, report back 16, split out 11, archive/park 11.

Already well served (not targets): `ag-mac run/push/pull` (one tool, 9% err mostly remote-command errors),
`ag_cua` tool (`ag cua`), `ag-tickler` tool, `op-*`, `ag-show`, `ag-shot`, `gh pr checks` polling (`pr-watch` + github relay).

## Proposed surface

**Status (2026-10-01): built.** Every verb below except the passthroughs exists as `bin/dot-local/lib/ag/<verb>`
(shared resolver: `aglib.py`); `ag <verb> --help` documents each. Also `ag unwait`. AGENTS.md and the
dotfiles-change skill now use them, ag-toolsum summarizes them (rule `ag-cli`), and `ag usage` measures adoption.

One entry point, `ag <verb>`. `ag` with no arguments keeps attaching (clients rely on it); `ag attach` is the
explicit form. Every session argument accepts a session id or prefix, a tab id, an ag-dash link, or a label
match, and is resolved fresh each call (never a cached pane id). Default target is the calling session,
found by `$PI_SESSION_FILE`, not the pane's tab env var. JSON with `--json`.

### Sessions (the GTD layer) — highest value

| Command | Replaces |
|---|---|
| `ag me` | self lookup → tab, pane, session id, ag-dash link |
| `ag ls [--inbox\|--pinned\|--waiting\|--needs-you]` | `api/state \| jq`, `tab list` |
| `ag find <text>` | open, hibernated and closed sessions by label + transcript; prints links |
| `ag search <description>` | fuzzy: an LLM picks the sessions a plain-words description means (ag-dash: Cmd+K) |
| `ag read <s> [--user\|--assistant] [--last N]` | transcript `jq`/python (incl. hibernated/closed) |
| `ag peek <s> [--lines N]` | `pane list \| jq` + `pane read` |
| `ag link [s]` | the old link helper / `ag-session-link` (`--phone`) |
| `ag spawn [-f file \| "prompt"] [--cwd D]` | inbox curl; appends the report-back instruction naming the caller |
| `ag report "msg"` | report back to the session that spawned me (inbox fallback) |
| `ag send <s> "msg" [--interrupt]` | pane lookup + `agent prompt` |
| `ag merge <A…> [--into B]` | transcript dump, `merged-into` + `session_info` entries, close A |
| `ag pin [on\|off] [s]`, `ag wait [s]`, `ag unwait` | `POST /api/card` |
| `ag rename "label" [s]`, `ag close [s] [--after N]` | `tab rename/close` |
| `ag resume <s>` | `POST /api/resume` |

### System

| Command | Replaces |
|---|---|
| `ag sync [ag\|dotfiles\|all]` | build AGENTS.md if stale, commit-check, push, then pull + restow + `install` + Hammerspoon reload on every machine in `machines/README.md`; reports unreachable ones |
| `ag status` | machines reachable, inbox/board/gateway/ag-presence/hibernate services, CUA queue, engine memory |
| `ag logs <service> [-f]`, `ag restart <service>` | `journalctl --user` / `systemctl --user` / `launchctl kickstart` on whichever machine runs it |

### Passthroughs (discoverability only)

`ag help` lists every Ag tool with one line each; `ag mac|show|shot|text|cua|presence|tickler|access|discord …`
forward to the existing commands, which keep their names.

## Notes for building it

- ag-dash already resolves sessions (`fileForSid`, `resumeSession`, cards by tab); board verbs should call
  its API, keyed by session id rather than tab (tabs change when a pane moves).
- After it lands, replace the jq recipes in AGENTS.md ("Split out", "Merge", session helper sections, the
  dotfiles-change sync steps) with the `ag` commands, and add `ag` to ag-toolsum so ag-dash summarizes it.

## Status

- 2026-10-01: `ag` is a dispatcher (`ag` alone still attaches; `ag <verb>` runs `~/.local/lib/ag/<verb>`, else
  an `ag-<verb>` tool; `ag help`). Built: `ag routine` (routines, docs/reference.md → "Routines") and `ag usage`
  (adoption meter; patterns in `bin/dot-local/lib/ag/usage-patterns.json`). Baseline adoption, 7 days: 0.6%
  (16 `ag` calls vs 2,491 hand-rolled). The weekly `ag-cli-usage` routine tracks it in `docs/ag-cli-usage.md`.
  The session and system verbs are being built in a split-out session ("ag CLI Build").
