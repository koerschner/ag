---
name: arcade-discord
description: Post or read messages on the team's Arcade Discord server (brain channels, threads, replies, teammate handles) with the `ag discord` CLI. Use whenever a message should go to Nathan's team, a teammate's "brain channel", or Discord.
---

# Arcade Discord

Follow the AI attribution rule and the "communicating with other people" rules in the global instructions for anything you post.

- Use Discord for messages to Nathan's team unless he explicitly says otherwise.
- Server: **Arcade** (ID `1524527312429912125`).
- **Brain channels:** each teammate has a personal channel named after them (e.g. `#frank` for Frank Yang). We call these their "brain channels". **Never post in someone's brain channel** (Nathan's rule, 2026-10-02), even when asked to message that person or the context lives there (that includes `--reply-to` a message in one); reading them is fine.
- **Where to post instead:** `#dev` (with an `<@USER_ID>` mention when it's for one person), or a DM to the person. `ag discord` has no DM command yet, so use `#dev` unless Nathan asks for a DM.

## How: the `ag discord` CLI (programmatic, no computer use)

`ag discord` (in ag, runs on ag-engine or any Ag machine) talks to the Discord API as the bot **Nathan's Assistant**, whose token is the op-work item `Discord bot (Arcade)` (vault ag-vault). Run `ag discord --help` for everything.

```bash
ag discord channels                           # channel + active-thread ids and names
ag discord threads frank                      # active and archived threads under #frank
ag discord read frank -n 50                   # recent messages (ids, links, reply targets)
ag discord get https://discord.com/channels/<guild>/<channel>/<message>
ag discord post dev "$(cat msg.md)"           # to a channel or a thread (name, id, or link)
ag discord post --reply-to <message link> "$(cat msg.md)"   # reply to one specific message
ag discord post <thread id> --file shot.png < msg.md
ag discord delete <message link>              # remove one of the bot's own posts
```

- **Posts come from the bot, not Nathan**, so the attribution line carries the "who": open with `<Assistant> (<model>), assisting Nathan:` and quote the body (`> ` on every line). `ag discord post` refuses text without it (`--no-attribution` only when Nathan explicitly asks). Use `--dry-run` to check the payload. Limit 2000 characters per message.
- To answer "where X asked about Y": `ag discord read`/`ag discord threads` to find the message, then `ag discord post --reply-to <its link>`.
- Mentions: write `<@USER_ID>` (ids from `ag discord read --json`); @everyone/@here and role pings are always suppressed.
- Bulk history or search over a date range: the `discord-export` skill (`ag discord dce …`).
- Access: the bot's managed role **Nathan's Assistant** has **Administrator** on the Arcade server (Nathan's call, 2026-10-02), so it can read and post in every channel, private ones included (#core, #lorena, #tsa…). It is only in the Arcade server: other servers (e.g. TSA's "Texas Sports Academy Devs") need the Discord app on ag-mac.
- Setup facts: the app (id `1555080030504230932`) is owned by Nathan's Discord account **koerschner** (login: op-shared item `Discord (koerschner)`); to rotate the token, Reset Token in the developer portal as koerschner and replace the op-work item.

## Fallback: computer use on ag-mac only

Only if the `ag discord` CLI is down (bot token missing/revoked, Discord API outage) or Nathan explicitly wants the message posted as himself: use the Discord desktop app on **ag-mac** (`mac cua` / the `chatgpt_cua` tool). If Discord on ag-mac is logged out, ask Nathan to sign it in (see "Tell Nathan what ag needs"). **Never** use the client Mac (`client-cua`) for Discord, and never enter Discord credentials or use Nathan's user token for automation (self-botting is against Discord's Terms of Service).

## People

- Donald Geddes is **Hbauer** on Discord (username `hbauer`; Linear `handlebauer`). For the Arcade Linear migration, coordinate with Donald only, not Benjamin Hitov or Eli (not on Nathan's team).
- Frank Yang is **Frank Y** on Discord (username `flankalanka`; GitHub `FlankaLanka`).
