---
name: arcade-discord
description: Post or read messages on the team's Arcade Discord server (brain channels, threads, replies, teammate handles) with the `discord` CLI. Use whenever a message should go to Nathan's team, a teammate's "brain channel", or Discord.
---

# Arcade Discord

Follow the AI attribution rule and the "communicating with other people" rules in the global instructions for anything you post.

- Use Discord for messages to Nathan's team unless he explicitly says otherwise.
- Server: **Arcade** (ID `1524527312429912125`).
- **Brain channels:** each teammate has a personal channel named after them (e.g. `#frank` for Frank Yang). We call these their "brain channels". When Nathan says to send something to someone's brain channel, post in their named channel on the Arcade server, not a DM.

## How: the `discord` CLI (programmatic, no computer use)

`discord` (in ag, runs on ag-engine or any Ag machine) talks to the Discord API as the bot **Nathan's Assistant**, whose token is the op-work item `Discord bot (Arcade)` (vault ag-vault). Run `discord --help` for everything.

```bash
discord channels                           # channel + active-thread ids and names
discord threads frank                      # active and archived threads under #frank
discord read frank -n 50                   # recent messages (ids, links, reply targets)
discord get https://discord.com/channels/<guild>/<channel>/<message>
discord post frank "$(cat msg.md)"         # to a channel or a thread (name, id, or link)
discord post --reply-to <message link> "$(cat msg.md)"   # reply to one specific message
discord post <thread id> --file shot.png < msg.md
```

- **Posts come from the bot, not Nathan**, so the attribution line carries the "who": open with `<Assistant> (<model>), assisting Nathan:` and quote the body (`> ` on every line). `discord post` refuses text without it (`--no-attribution` only when Nathan explicitly asks). Use `--dry-run` to check the payload. Limit 2000 characters per message.
- To answer "where X asked about Y": `discord read`/`discord threads` to find the message, then `discord post --reply-to <its link>`.
- Mentions: write `<@USER_ID>` (ids from `discord read --json`); @everyone/@here and role pings are always suppressed.
- Bulk history or search over a date range: the `discord-export` skill (`discord dce …`).
- A 403 means the bot can't see that channel (private channel it isn't in). Tell Nathan which channel; don't work around it.

## Fallback: computer use on ag-mac only

Only if the `discord` CLI is down (bot token missing/revoked, Discord API outage) or Nathan explicitly wants the message posted as himself: use the Discord desktop app on **ag-mac** (`mac cua` / the `chatgpt_cua` tool). If Discord on ag-mac is logged out, ask Nathan to sign it in (see "Tell Nathan what ag needs"). **Never** use the client Mac (`client-cua`) for Discord, and never enter Discord credentials or use Nathan's user token for automation (self-botting is against Discord's Terms of Service).

## People

- Donald Geddes is **Hbauer** on Discord (username `hbauer`; Linear `handlebauer`). For the Arcade Linear migration, coordinate with Donald only, not Benjamin Hitov or Eli (not on Nathan's team).
- Frank Yang is **Frank Y** on Discord (username `flankalanka`; GitHub `FlankaLanka`).
