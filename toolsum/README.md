# toolsum: deterministic tool-call summaries

AG Dash shows each agent tool call as a one-line summary plus the machine it runs on, instead of the raw
command:

| raw | shown |
|---|---|
| `mac run 'pkill -x Telegram; xattr -dr com.apple.quarantine /Applications/Telegram.app'` | `ag-mac` Stop Telegram · Clear quarantine on /Applications/Telegram.app |
| `chatgpt_cua` "On this Mac there is a macOS Gatekeeper dialog … Click "Open"." | `ag-mac` Telegram: Click "Open" |
| `cd ~/arcade.school && bun scripts/db query --stage production arcade "select … from play_sessions"` | `ag-engine` Query production arcade DB: play_sessions |

- **Deterministic.** `toolsum.ts` is plain rules (regexes and small functions), no model. Same input, same output.
- **Exact or nothing.** A shell command is split into its pieces (`;`, `&&`, `|`, `$( )`, `ssh host '…'`,
  `mac run '…'`); a summary appears only when every meaningful piece matched a rule (`echo`, `sleep`, `cd`, and
  pipe filters like `| head` are ignored). Otherwise AG Dash shows the raw command. The raw command is always on
  hover and in the expanded row.
- **The `ag` CLI.** `ag <verb>` calls (docs/ag-cli.md, `bin/dot-local/lib/ag/`) get one summary per verb (rule
  `ag-cli`: "Send "…" to tCY", "Merge tD2 into this session", "Sync ag to every machine" …); passthrough verbs
  (`ag text`, `ag mux` …) are summarized as the `ag-*` tool they run. When you add a verb, add its case and a fixture.
- **Machine chips.** `chatgpt_cua`/`mac …` → ag-mac, `client-cua`/`ssh ag-client` → ag-client, TapKit →
  ag-phone, MCP tools → mcp, everything else → the session's own machine (from its working directory).

## Files

- `toolsum.ts`: the library (`summarize(name, args, {host})`), imported by `bin/dot-local/bin/ag-board`.
- `fixtures.json`: golden examples; `toolsum check` must pass after every change.
- `skip.json`: unmatched shapes deliberately left raw (opaque variables, one-off scripts), with a reason.
- `bin/dot-local/bin/toolsum`: `check`, `coverage [--days N] [--json]`, `sample`, `try`, `sh`.

## The routine

`toolsum-review` (systemd `toolsum-review.timer`, daily 9am Central on the session host) measures coverage over
the last 7 days of Pi sessions. When an unmatched shape not in `skip.json` has 10+ calls, it runs a
non-interactive Pi session in a fresh worktree to add rules (each with a fixture), skip hopeless shapes, and fix
misleading summaries from a random sample. It merges only if the fixtures pass and coverage didn't drop, then
pushes to ag main and restarts AG Dash. Its last result shows in AG Dash → Routines. Run it by hand with
`toolsum-review --dry-run` (measure only) or `--force` (skip the gate).
