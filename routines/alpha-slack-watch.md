---
description: Watch the Alpha Slack (go-alpha) beyond the TSA Arcade channels for Minecraft, Roblox, Arcade, kids' gaming/social-platform mentions; ping Nathan on new ones
schedule: calendar Mon..Fri *-*-* 08..18/2:17:00 America/Chicago
kind: prompt
cwd: ~
timeout: 20min
enabled: true
---
Goal: Nathan runs the Arcade (arcade.school), a moderated social/gaming platform for kids (Minecraft, Roblox, chat,
factions) integrated with Timeback, used by Texas Sports Academy (TSA). People across Alpha School post about
Minecraft, Roblox, game-based motivation, or kids' social platforms in channels he doesn't watch, and he misses them
(e.g. 2026-09-30 Joe "Yeti" Livingstone in #org-wide-collab asked for an Alpha Minecraft account; several people
asked to be connected to "the Superbuilders who built an arcade"; Nathan only heard by email). Catch those.

Use the `mcp_slack_alpha_*` tools (workspace go-alpha.slack.com; Nathan is U0BEES3UT3P). Read-only: never post,
react, join channels, or mark anything read.

1. Search messages from the last 2 days (`filter_date_after` = yesterday's date) for each of: Minecraft, Roblox,
   arcade, "arcade.school", Playcademy, superbuilders, "game time", "motivational model", gaming, "video games",
   "social platform", socialize, Timeback games. Exclude the channels Nathan already lives in by adding
   `-in:#arcade2026825 -in:#tsa-online-guides -in:#sms-bot-escalations -in:#ask-tessa` to the query, and skip
   DMs/group DMs (channel ids starting with D, or names starting with mpdm-) and Tessa's bot posts.
2. Keep a hit only if it's about kids' gaming, Minecraft/Roblox, game-based rewards/motivation, kids' social
   features, or mentions the Arcade/Superbuilders, AND it's something Nathan might want to act on: a question or
   need the Arcade could answer, a request to connect with the Arcade team, a campus doing its own Minecraft/Roblox
   thing, policy (blocking games, screen time) that affects the Arcade, or a direct mention of him or the Arcade.
   Ignore unrelated uses ("game film", sports games, "gaming the XP system").
3. Dedup against ~/.local/state/routines/alpha-slack-watch/seen.txt (one `<channel_id>/<thread_ts or ts>` per
   line; a reply in a known thread counts as new only if it changes the picture, e.g. someone new asks for him).
   Append every kept key.
4. If there are new hits: send Nathan one short notification with
   `ag-text "🕹️ Alpha Slack: <n> new — <one-line gist of the top one>"`, then open one Inbox session with the
   details: `ag spawn --no-report "Alpha Slack watch found these new posts for Nathan: ..."` listing, per hit, the
   channel, author, date, a one-line summary, the permalink, and a suggested next step (e.g. reply offering the
   Arcade, ask Pamela for the intro). Suggest replies only as drafts in Nathan's voice; don't send anything.
   If nothing new, do nothing but finish.
Success = seen.txt updated, and Nathan notified only when there is something genuinely new and relevant.
End with a one-line summary (e.g. "2 new hits: #org-wide-collab Minecraft account, #supportcollab Bedrock event").
