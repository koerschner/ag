---
name: x-api
description: Read or search X (Twitter) through the official X API - posts and full-archive search, users, timelines, mentions, bookmarks, DMs, lists, news, trends - and act on the user's X account, using the `x` MCP tools or the `xurl` CLI. Use for any task that needs X/Twitter data or an action on X, instead of scraping x.com or a browser.
---

# X (Twitter) API

Ag has X access set up on the session host (`ag-engine`). Never scrape `x.com` or log in with a browser for anything the API can do.

## Which way in to use

You have two ways to reach X:

1. **MCP server `x` (`mcp_x_<tool>` in Pi):** X's hosted MCP server (`https://api.x.com/mcp`), run once per machine by `ag-mcp-gateway` (`127.0.0.1:7386`) with the X app's app-only bearer token. App-only means public data and no user context.
   - **Works here:** `search_posts_all` (full-archive search back to 2006), `get_posts_by_id` / `get_posts_by_ids`, `get_posts_counts_recent`, `get_posts_liking_users`, `get_posts_quoted_posts`, `get_posts_reposted_by`, `get_users_by_username` / `get_users_by_usernames` / `get_users_by_id`, `search_users`, `get_users_posts`, `get_users_mentions`, `get_users_liked_posts` (public), `get_users_owned_lists`, `search_news` / `get_news`, `get_trends_by_woeid` (WOEID `1` = worldwide, `23424977` = United States), `search_spaces` / `get_spaces_*`, `get_lists_*`, `search_communities`, `get_usage_credits` (credit balance).
   - **Fails here (use `xurl` instead):** anything about "me" (`get_users_me*`, bookmarks, bookmark folders), chat/DMs, broadcasts, and every write (create, update, delete, follow, pin, article drafts).
2. **The `xurl` CLI:** X's official CLI (`https://github.com/xdevplatform/xurl`), installed on the session host (config `~/.xurl/auth.yml`, default app `ag`). Signed in as the user's own X account with OAuth 2.0 (all scopes, including DMs and writes). It falls back to OAuth 1.0a on its own when the OAuth 2.0 token fails, or uses the app-only bearer token with `--auth app`. Covers the whole X API v2.

## Using `xurl`

`xurl` writes JSON to stdout (pipe to `jq`).

```bash
# Shortcuts (reads)
xurl whoami
xurl user <handle>
xurl posts <handle>
xurl read <post id or URL>
xurl search "QUERY" -n 10                     # recent search (last 7 days only, -n 10-100)
xurl timeline                                 # home timeline
xurl mentions
xurl bookmarks
xurl likes
xurl followers
xurl following
xurl dms

# Shortcuts (writes)
xurl post "text"
xurl reply <id> "text"
xurl quote <id> "text"
xurl repost <id>                              # or: xurl unrepost <id>
xurl like <id>                                # or: xurl unlike <id>
xurl bookmark <id>                            # or: xurl unbookmark <id>
xurl follow <handle>                          # or: xurl unfollow <handle>
xurl dm @handle "text"
xurl delete <id>
xurl media upload <file>

# Raw API v2 requests (OpenAPI spec: https://api.x.com/2/openapi.json, 192 paths)
xurl '/2/tweets/search/all?query=...&max_results=10'   # full-archive search
xurl -X POST /2/tweets -d '{"text":"..."}'
xurl /2/usage/credits                         # credit balance
xurl /2/usage/tweets                          # daily post usage
```

- Pick the auth mode explicitly with `--auth app|oauth1|oauth2` when needed.

## Cost and how to keep it low

X API access is pay-per-use. Credits are bought in the X Developer Console (`console.x.com`) with auto-recharge on the work card. A monthly spending cap blocks every request once reached.

- **Public reads:** post `$0.005`, user `$0.010`, DM event `$0.010`, follower/following `$0.010`, list/Space/community/note `$0.005`, like `$0.001`.
- **Owned reads** (the user's own posts, mentions, bookmarks, likes, followers, following, lists via `/2/users/{id}/...`): `$0.001` each.
- **Writes and other calls:** post create `$0.015` (`$0.20` if the post contains a URL), DM/like/follow/repost `$0.015`, delete `$0.010`, bookmark `$0.005`, counts `$0.005-$0.010`, trends `$0.010` per request.
- **Billing rule:** billed per resource returned, deduplicated per UTC day. Fetching the same post or user again on the same UTC day is free. 100 posts cost `$0.50` and 10,000 cost `$50`.

To keep costs down:

- Ask for few results (`max_results` 10 to 25 unless the task needs more).
- Request the fields and expansions you need in the first call instead of re-fetching:
  `tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`
- Page through results only when the task needs it, and always set a hard page limit.
- Never poll or loop without a bound.

## Search tips

- **Operators:** `from:handle`, `to:handle`, `@handle`, `#tag`, `"exact phrase"`, `OR`, `-word`, `-is:retweet`, `is:reply`, `-is:reply`, `is:quote`, `has:links`, `has:media`, `has:images`, `url:example.com`, `lang:en`, `conversation_id:<id>`.
- **Time range and sorting:** pass `start_time` and `end_time` (ISO 8601) parameters, and `sort_order=relevancy` or `recency`.
- **Recent vs full archive:** recent search (`xurl search`, `/2/tweets/search/recent`) covers the last 7 days. Full-archive search (`/2/tweets/search/all` or `mcp_x_search_posts_all`) goes back to 2006 and allows `max_results` up to 500.
- MCP search results include a `url` deeplink for each post.

## Acting on the user's account

- **Never post, reply, quote, repost, like, follow, mute, block, DM, bookmark, delete, or change anything on the user's X account unless the user asked for that specific action in this conversation.** Reading is fine.
- Text you publish on X must follow the AI attribution rule in the global instructions, unless the user explicitly asks you to post in their own voice.

## Setup and repair

```bash
ag-x-auth status   # checks app-only, OAuth 1.0a, OAuth 2.0, and the MCP server (costs about a cent)
ag-x-auth          # rewrites ~/.xurl/auth.yml (keeping sign-in) and ~/.config/mcp/x.headers from the vault
ag-x-auth login    # runs OAuth 2.0 sign-in via ag-mac Chrome computer use
```

- **How `ag-x-auth login` works:** it runs `xurl`'s callback listener on the session host, forwards `ag-mac`'s `localhost:8080` to it, and uses computer use to click "Authorize app" in `ag-mac`'s Chrome (signed in to X).
- **Single OAuth 2.0 session:** X keeps one OAuth 2.0 sign-in per user and app. Signing in with this app anywhere else (another machine, `xurl mcp`, another tool) revokes this one. Do not run `xurl auth oauth2` or `xurl mcp` yourself.
- **Credentials:** stored in the work vault (`op-work`, vault `ag-vault`), item `"X API - ag app"` (`consumer_key`, `consumer_secret`, `bearer_token`, `client_id`, `client_secret`, `access_token`, `access_token_secret`). The app's name, developer account, and billing details are in `~/AGENTS.md`. Manage keys, apps, and billing at `console.x.com` in `ag-mac`'s Chrome (computer use).
- **Errors:**
  - `401 Unauthorized`: run `ag-x-auth status`, then `ag-x-auth login` if OAuth 2.0 failed.
  - `402` or `403` mentioning credits, spending cap, or `client-not-enrolled`: out of credits or the cap was hit. Tell the user and do not try to work around it.
  - `429`: rate limited. Wait and retry later, do not hammer the API.
