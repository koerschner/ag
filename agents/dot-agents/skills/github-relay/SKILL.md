---
name: github-relay
description: How arcade PR watching works with the team's GitHub relay (internal/github-relay), which pushes PR events (reviews, approvals, bot findings, CI, conflicts, merge, deploy) to agents instead of polling. Use whenever you open or watch an arcade PR, wait on a review or approval, or want a wake-up when something happens on a PR.
---

# GitHub relay (arcade PR events, pushed)

## What it is

Donald Geddes (Hbauer) built it (ARC-869, PR #1733, 2026-09-28) and announced it in `#dev` on 2026-09-29. Before it, every agent's PR monitor (`watch-pr.sh`) polled GitHub every 20 s. Now:

- GitHub sends a webhook to a Cloudflare Worker at `https://github-relay.arcade.playcademy.net` (staging only, there is no production relay) through a read-only GitHub App, `arcade-github-relay`.
- One Durable Object per PR re-reads the PR and turns it into the same one-line events `watch-pr.sh` prints, and streams them to every watcher over Server-Sent Events.
- Events arrive 10-20 s sooner than polling, the watch follows a merged PR until its deploy finishes (`DEPLOYED` / `NOT DEPLOYED`), and it reports `CONFLICT` when `dev` moves and the branch no longer merges. Everything is traced in Honeycomb.

Source and design: `internal/github-relay/AGENTS.md` in the arcade repo. The watcher script and its event list: `.agents/skills/arcade-resolve-pr-feedback/scripts/watch-pr.sh` (the header comment documents every line).

## The token

`GH_RELAY_TOKEN` in the main checkout's `.env.local` (`~/arcade.school/.env.local` on ag-engine and ag-mac; worktrees find it through the shared git dir). Source of truth: the "arcade local dev credentials" note in the arcade.school 1Password vault (`op-ag`). Without it the watcher silently falls back to polling. Never print it.

## Watching a PR

Normal path (polls if the relay is unreachable, retries the relay every minute):

```bash
cd <arcade worktree on a recent dev>
nohup bash .agents/skills/arcade-resolve-pr-feedback/scripts/watch-pr.sh <pr> > /tmp/watch<pr>.log 2>&1 &
```

Gotcha: `watch-pr.sh` re-runs dev's copy of itself (`.agents/lib/from-dev.sh`), but a checkout too old to have the relay code (before 2026-09-28) never streams. Run it from a worktree based on current `dev`, or call the relay client directly:

```bash
cd ~/arcade.school
GH_RELAY_URL=https://github-relay.arcade.playcademy.net \
GH_RELAY_TOKEN="$(sed -n 's/^GH_RELAY_TOKEN=//p' .env.local | tr -d "\"'")" \
nohup bun <dev-checkout>/internal/github-relay/bin/pr-watch.ts superbuilders/arcade.school <pr> > /tmp/watch<pr>.log 2>&1 &
```

It prints lines like `HEAD`, `FINDING`, `REPLY`, `NOTE`, `APPROVED <person> <sha>`, `CHANGES REQUESTED`, `REVIEWED <bot>`, `BOTS DONE`, `CHECKS ... passed|failed`, `CONFLICT`, `READY`, `REVIEW <sha> <words>` (the `pr-review` fast-lane gate), `MERGED`, `DEPLOYED`. `fetch-feedback.sh <pr>` gives a finding's full text.

## Waiting on a review (Waiting for column)

Don't hold a turn open. Schedule a tickler `when: "check"` wake-up that greps the log from the current head, ignoring the bots' own noise, so the session sits in AG Dash's Waiting for and resumes when something real happens:

```bash
H=$(gh pr view <pr> -R superbuilders/arcade.school --json headRefOid -q '.headRefOid[0:9]')
awk -v h="HEAD $H" '$0==h{f=1} f' /tmp/watch<pr>.log \
  | grep -vE '^(NOTE arcade-mechanic|REPLY (cursor|greptile|qodo))' \
  | grep -qE '^(APPROVED|CHANGES REQUESTED|NOTE|REPLY|FINDING|CHECK FAILED|CHECKS .*failed|CONFLICT|MERGED|CLOSED)'
```

Leave `needsNathan` off unless the thing you wait for is Nathan himself. When it fires: handle it, then schedule the next one from the new head. Exclude thread ids you already answered if a bot's reply to you would retrigger it.

## Notes

- A PR that adds migrations or touches protected paths gets `pr-review: Needs a human: waiting for approval`; only an approval from someone other than the author clears it.
- `CONFLICT` on a migration PR: merge `origin/dev`, take dev's `migrations/meta`, delete your migration, regenerate it on top (`bunx drizzle-kit generate --name ...` in `apps/arcade`), and recreate the preview DB (`bun scripts/db preview create --stage pr-<n>`).
- Ask Donald (Hbauer, `hbauer` on Discord) about relay bugs; fixes land in `internal/github-relay` with parity tests against the jq scripts.
