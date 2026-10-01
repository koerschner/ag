# `ag` CLI: audit and proposed surface

Audit date: 2026-10-01. Source: every Pi session started since 2026-09-17 on the session host (664 sessions,
34,314 tool calls, 28,612 of them `bash`). Counts are `calls / sessions`. Script: patterns over the extracted
`bash` commands plus their tool results (error column = result contained an error / `not found` / `empty`).

Today `ag` only attaches a terminal to the session host (`bin/dot-local/bin/ag`). Everything else agents do
to Ag is hand-rolled `ag-mux`/`herdr` + `jq`, `curl` to AG Dash or the inbox, or `jq`/`python` over session
`.jsonl` files, re-derived from AGENTS.md prose each time.

## What agents actually do by hand

| Workflow | Calls / sessions | Err | How it's done today |
|---|---|---|---|
| Read other sessions' screens | 549 / 136 | | `ag-mux pane list \| jq` for the pane, then `pane read --source recent-unwrapped` |
| Read a session transcript | 260 / 96 (733 / 186 incl. any grep over `.jsonl`) | 14% | `jq 'select(.message.role=="user")…'` or python, after finding the file |
| Find a tab by label | 417 / 145 | | `tab list --workspace X \| jq '.label'`, per workspace |
| Find *my own* pane/tab ("who am I") | 251 / 101 | 10% | `pane list \| jq --arg f "$PI_SESSION_FILE"`; 69 / 50 more trusted a possibly stale `$HERDR_TAB_ID` |
| Commit + push ag/dotfiles | 373 / 153 | | manual; then `ssh ag-client/ag-mac 'git pull && stow … && hs reload'` per machine |
| Spin out / split out (inbox) | 370 / 68 | 18% | heredoc → `curl -H content-type:text/plain --data-binary @f 'http://ag:7373/prompt?new=1'`; forgotten header → `empty` |
| Prompt another session | 272 / 92 | 15% | resolve pane, `agent prompt`; stale pane ids → `agent_not_found` |
| AG Dash API (state, card, transcript, new, close) | 327 / 55 | 8% | `curl :7376/api/state \| jq`; hotpath = `POST /api/card {"tab","hot":true}` after a self-lookup |
| launchctl / systemctl / journalctl / log tails | 368+76+191 | | per-service, per-machine incantations |
| `agents.md/build` | 99 / 51 | | separate step before every ag commit |
| Tab create + agent start | 88+68 / 44 | 8% | two calls plus JSON parsing |
| Tab close (incl. self-close) | 136 / 81 | | `tab close $(self lookup)`, sometimes `nohup sleep 25; tab close` |
| Merge sessions | 29 / 15 | | hand-built `merged-into` + `session_info` JSONL with `jq -nc`, then close |
| Find "the session where I was doing X" | 46 / 28 grep -l, 69 / 16 api/state, 15 herdr-find | | ad hoc; Nathan asked "find that session" in ~20 prompts |

Nathan's own prompts (same window) ask for these Ag-level actions: put in waiting 81, defer/tickler 44,
merge 31, close tab 25, give me the link 22, hotpath 21, report back 16, split out 11, archive/park 11.

Already well served (not targets): `mac run/push/pull` (one tool, 9% err mostly remote-command errors),
`chatgpt_cua` tool, `tickler` tool, `op-*`, `show`, `shot`, `gh pr checks` polling (`pr-watch` + github relay).

## Proposed surface

One entry point, `ag <verb>`. `ag` with no arguments keeps attaching (clients rely on it); `ag attach` is the
explicit form. Every session argument accepts a session id or prefix, a tab id, an AG Dash link, or a label
match, and is resolved fresh each call (never a cached pane id). Default target is the calling session,
found by `$PI_SESSION_FILE`, not `$HERDR_*`. JSON with `--json`.

### Sessions (the GTD layer) — highest value

| Command | Replaces |
|---|---|
| `ag me` | self lookup → workspace, tab, pane, session id, AG Dash link |
| `ag ls [--hot\|--waiting\|--needs-you] [workspace]` | `api/state \| jq`, `tab list` per workspace |
| `ag find <text>` | open, hibernated and closed sessions by label + transcript; prints links |
| `ag read <s> [--user\|--assistant] [--last N]` | transcript `jq`/python (incl. hibernated/closed) |
| `ag peek <s> [--lines N]` | `pane list \| jq` + `pane read` |
| `ag link [s]` | `herdr-link` / `session-link` (`--phone`) |
| `ag spawn [-f file \| "prompt"] [--ws W] [--cwd D]` | inbox curl; appends the report-back instruction naming the caller |
| `ag report "msg"` | report back to the session that spawned me (inbox fallback) |
| `ag send <s> "msg" [--interrupt]` | pane lookup + `agent prompt` |
| `ag merge <A…> [--into B]` | transcript dump, `merged-into` + `session_info` entries, close A |
| `ag hot [on\|off] [s]`, `ag wait [s]`, `ag unwait` | `POST /api/card` |
| `ag file <workspace> [s]`, `ag rename "label" [s]`, `ag close [s] [--after N]` | `tab move/rename/close` |
| `ag resume <s>` | `POST /api/resume` |

### System

| Command | Replaces |
|---|---|
| `ag sync [ag\|dotfiles\|all]` | build AGENTS.md if stale, commit-check, push, then pull + restow + `install` + Hammerspoon reload on every machine in `machines/README.md`; reports unreachable ones |
| `ag status` | machines reachable, inbox/board/gateway/presence/hibernate services, CUA queue, engine memory |
| `ag logs <service> [-f]`, `ag restart <service>` | `journalctl --user` / `systemctl --user` / `launchctl kickstart` on whichever machine runs it |

### Passthroughs (discoverability only)

`ag help` lists every Ag tool with one line each; `ag mac|show|shot|text|cua|presence|tickler|access …`
forward to the existing commands, which keep their names.

## Notes for building it

- AG Dash already resolves sessions (`fileForSid`, `resumeSession`, cards by tab); board verbs should call
  its API, keyed by session id rather than tab (tabs change when the Inbox auto-filer moves them).
- After it lands, replace the jq recipes in AGENTS.md ("Split out", "Merge", Herdr helper sections, the
  dotfiles-change sync steps) with the `ag` commands, and add `ag` to toolsum so AG Dash summarizes it.
