---
name: arcade-discord
description: Post or read messages on the team's Arcade Discord server (brain channels, threads, replies, teammate handles) with the `ag discord` CLI. Use whenever a message should go to the user's team, a teammate's "brain channel", or Discord.
---

# Arcade Discord

Follow the AI attribution rule and the "communicating with other people" rules in the global instructions for anything you post.

- Use Discord for messages to the user's team unless they explicitly say otherwise.
- Server: **Arcade**. Server ID, the bot's vault item, and the team roster (handles, user IDs) are in the user's private personal instructions (`~/AGENTS.md`).
- **Brain channels:** each teammate has a personal channel named after them (e.g. `#<name>`). We call these their "brain channels". **Never post in someone's brain channel** (the user's rule, 2026-10-02), even when asked to message that person or the context lives there (that includes `--reply-to` a message in one); reading them is fine.
- **Where to post instead:** `#dev` (with an `<@USER_ID>` mention when it's for one person), or a DM to the person. `ag discord` has no DM command yet, so use `#dev` unless the user asks for a DM.

## How: the `ag discord` CLI (programmatic, no computer use)

`ag discord` (in ag, runs on ag-engine or any Ag machine) talks to the Discord API as the ag bot (display name in the personal instructions), whose token is an op-work item (see the personal instructions). Run `ag discord --help` for everything.

```bash
ag discord channels                           # channel + active-thread ids and names
ag discord threads <name>                     # active and archived threads under #<name>
ag discord read <name> -n 50                  # recent messages (ids, links, reply targets)
ag discord get https://discord.com/channels/<guild>/<channel>/<message>
ag discord post dev "$(cat msg.md)"           # to a channel or a thread (name, id, or link)
ag discord post --reply-to <message link> "$(cat msg.md)"   # reply to one specific message
ag discord post <thread id> --file shot.png < msg.md
ag discord delete <message link>              # remove one of the bot's own posts
```

- **Posts come from the bot, not the user**, so the attribution line carries the "who": open with `<Assistant> (<model>), assisting <user>:` and quote the body. Discord shows a bare `>` line literally, so `ag discord post` rewrites the body into one `>>> ` block quote (everything after it, blank lines and code blocks included); per-line `> ` input is converted for you. `ag discord post` refuses text without it (`--no-attribution` only when the user explicitly asks). Use `--dry-run` to check the payload. Limit 2000 characters per message.
- To answer "where X asked about Y": `ag discord read`/`ag discord threads` to find the message, then `ag discord post --reply-to <its link>`.
- Mentions: write `<@USER_ID>` (ids from `ag discord read --json`); @everyone/@here and role pings are always suppressed.
- Bulk history or search over a date range: the `discord-export` skill (`ag discord dce …`).
- Access: the bot's managed role has **Administrator** on the Arcade server (the user's call, 2026-10-02), so it can read and post in every channel, private ones included. It is only in the Arcade server: other servers need the Discord app on ag-mac.
- Setup facts: the app is owned by the user's own Discord account (details in the personal instructions); to rotate the token, Reset Token in the developer portal as that account and replace the op-work item.

## Fallback: computer use on ag-mac only

Only if the `ag discord` CLI is down (bot token missing/revoked, Discord API outage) or the user explicitly wants the message posted as themselves: use the Discord desktop app on **ag-mac** (`ag-mac cua` / the `chatgpt_cua` tool). If Discord on ag-mac is logged out, ask the user to sign it in (see "Tell the user what ag needs"). **Never** use the client Mac (`ag-client-cua`) for Discord, and never enter Discord credentials or use the user's user token for automation (self-botting is against Discord's Terms of Service).

