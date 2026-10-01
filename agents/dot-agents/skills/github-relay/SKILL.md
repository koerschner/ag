---
name: github-relay
description: How the arcade team's GitHub relay pushes PR events (reviews, approvals, bot findings, CI, conflicts, merge, deploy) to agents, and how Ag agents watch a PR with it and wake up on a tickler instead of polling. Use whenever you open or babysit an arcade.school PR, wait for a review or approval, or need to know when CI, a merge, or the staging deploy finishes.
---

# GitHub relay: PR events pushed to agents

## What it is

Donald ("hbauer" on Discord, `handlebauer` on GitHub) built it on 2026-09-28 (ARC-869, PR #1733) and announced it in the Arcade Discord's `#dev` on 2026-09-29. Before, every agent's PR monitor polled GitHub on an interval. Now:

1. A GitHub App, `arcade-github-relay` (read-only, installed on `superbuilders/arcade.school`), sends every PR-related webhook (reviews, review comments, threads, check runs, statuses, pushes) to a Cloudflare Worker at `https://github-relay.arcade.playcademy.net`.
2. The Worker keeps one Durable Object ("room") per PR. On a webhook it re-reads the PR once, turns the snapshot into the same one-line events `watch-pr.sh` prints, logs them with sequence numbers, and streams them to every connected watcher over Server-Sent Events.
3. A watcher (arcade's `watch-pr.sh`, which runs `internal/github-relay/bin/pr-watch.ts`) connects with the team token and resumes from the last event it saw.

What that buys over polling: events arrive 10-20 s sooner. The watch also keeps going after the merge until the merge commit's staging deploy (`DEPLOYED` / `NOT DEPLOYED`). And an open PR gets `CONFLICT` as soon as `dev` moves underneath it. Everything is instrumented in Honeycomb (PR creation → staging deploy). The relay runs on staging only; there is no production relay. Code and design: `internal/github-relay/AGENTS.md` in arcade.school.

## The token

`GH_RELAY_TOKEN` lives in the **arcade local dev credentials** note in 1Password, the arcade.school vault (`op-ag`; vault `jjbrfvemdg4y3prkikxur6thbq`). The watcher reads it from the **main checkout's** `.env.local` (`~/arcade.school/.env.local`), or from the environment. Without it the watcher silently falls back to polling GitHub every 20 s. Check with `grep -c '^GH_RELAY_TOKEN=' ~/arcade.school/.env.local`; if it's missing on a machine, copy it in from 1Password (never print it).

## Watching a PR (Ag)

Use the `pr-watch` helper (ag repo, `bin/`):

```bash
pr-watch 1777            # or a PR URL; second arg = repo checkout (default ~/arcade.school)
```

It extracts **dev's** copy of `watch-pr.sh` and the relay client fresh from `origin/dev` (so a stale or detached main checkout still gets the relay), stops any older watcher for that PR, starts the new one in the background, and logs to `/tmp/watch-pr-<n>.log`. It also prints a ready-made tickler check. Running `bash .agents/skills/arcade-resolve-pr-feedback/scripts/watch-pr.sh <n>` from an up-to-date arcade checkout does the same in the foreground (its `.agents/lib/from-dev.sh` re-runs dev's copy). The repo's `arcade-create-pull-request` and `arcade-resolve-pr-feedback` skills say to start one monitor per PR. On Ag, start it with `pr-watch` and wait on a tickler (below), instead of a long-lived foreground monitor.

### The event lines

| Line | Meaning |
| --- | --- |
| `HEAD <sha>` | a new commit was pushed |
| `FINDING <bot> <where>: <title> <thread-id>` | a new open review finding (Greptile, Cursor Bugbot, Qodo) |
| `REVIEWED <bot> <sha>: <note>` | a review bot finished the head |
| `BOTS DONE <sha>: <n> open` | every required bot reviewed the head |
| `NOTE <author>: …` | a person's (or the fast lane app's) top-level comment or review body |
| `REPLY <who> <where>: …` | someone replied in a thread after its last answer |
| `APPROVED <person> <sha>` | a person approved that commit |
| `CHANGES REQUESTED <sha>` | a reviewer requested changes (blocks READY) |
| `CONFLICT <sha>` | the head no longer merges into `dev`: merge `dev` in |
| `CHECK FAILED <sha> <check>` / `CHECKS <sha> passed\|failed` | CI results |
| `REVIEW <sha> <words>` / `NOTICE <title>` | the fast lane's `pr-review` gate changed, or asks a person to act |
| `READY <sha>` | bots done, nothing open, CI green, no conflict; its note says what the merge still waits on (an approval) |
| `MERGED <sha>` → `DEPLOYED` / `NOT DEPLOYED` | merged, then the staging deploy outcome; the watch ends |

`fetch-feedback.sh <pr>` (same skill folder) prints the full text of every open finding.

## Waiting on a PR without holding the turn

Never sit in a long foreground monitor or `sleep` loop. Start `pr-watch`, then schedule a tickler wake-up whose `check` greps the log from the current head, and end the turn:

```text
tickler schedule  when: "check"
  check: awk '/^HEAD <sha>/{f=1} f' /tmp/watch-pr-<n>.log | grep -vE '^(NOTE arcade-mechanic|REPLY (cursor|greptile|qodo))' | grep -qE '^(APPROVED|CHANGES REQUESTED|NOTE|REPLY|FINDING|CHECK FAILED|CHECKS .*failed|CONFLICT|READY|MERGED|CLOSED)'
  expires: a week out
```

- Anchor on the current `HEAD <sha>` line, so events you already handled don't fire it again. After each push, reschedule from the new head.
- Don't pass `needsNathan` when you're waiting on a teammate's review or approval: the card then sits in AG Dash's **Waiting for** column. Use `needsNathan: true` only when Nathan himself must act.
- The check is POSIX `sh` (no `<(…)`), and runs every minute without a model.
- When it fires: read the log from that head, handle the event (fix findings, reply in threads with the AI attribution line, merge on approval), and reschedule if you're still waiting.

## Gotchas

- **Approval gate:** PRs touching protected paths (migrations, etc.) get the fast lane's `pr-review` status "Needs a human: waiting for approval". It needs an approving review from someone **other than the author**; GitHub won't let Nathan approve his own PR. Ask him who should review; don't request reviewers yourself unless he says so.
- **Killing a watcher:** `pkill -f "watch-pr.sh <n>"` also matches the shell running that command and kills your own tool call. Loop over `pgrep` and skip `$$` (as `pr-watch` does).
- **Stale checkout = polling:** a main checkout from before 2026-09-28 has no relay client and no `from-dev.sh`, so its `watch-pr.sh` only polls. `pr-watch` avoids that by always running dev's copy.
- **Migration races:** `dev` moves fast. On `CONFLICT` involving `apps/arcade/migrations`, take `dev`'s `meta/` files, delete your migration, and regenerate it on top (`bunx drizzle-kit generate --name <name>` in `apps/arcade`). Then recreate that PR's preview database (`bun scripts/db preview create --stage pr-<n>`), because the preview already applied the old numbering.
