---
name: visual-review-page
description: Build a self-contained HTML review page showing every changed screen in context (storyboard, real renders, before/after) and open it on the user's screen. Use whenever work changes something people see (UI, dialogs, native alerts, emails, dashboards, copy) before asking them to approve it.
---

# Visual review pages

Whenever work changes something people see (UI screens, dialogs, native alerts, emails, dashboards, copy), give the user a review page before asking them to approve it: one self-contained HTML file that shows every changed screen **in context**, then open it on their screen with `ag-show`. Screenshots in chat alone aren't enough.

- **In context:** for each screen, say who sees it, when, and what just happened (e.g. "Kid pressed Play with Roblox signed into the wrong account"), then the screenshot, then what they can do next. Order the screens as the user meets them, like a storyboard. Show the before next to the after when something existing changed.
- **Real renders, not mockups:** capture the actual component (Storybook stories plus headless Playwright; add a story when a state has none), the real native UI (render the actual `NSAlert` or window offscreen to PNG), or the running app. Mark anything that isn't the real render.
- **Flows as video:** when the change is a flow (several steps, animation, navigation), record it and put the video in the page: `ag-record-flow <url> [flow.ts]` for headless Playwright (Storybook, staging, dev server), or `ag-screen-record start [-w "Google Chrome"]` / `ag-screen-record stop` around a `ag-chatgpt-cua` run on ag (`ag-rec` for a polished, dead-time-cut version with a smooth cursor and click zoom). Details: docs/reference.md, "Screen recordings (QA video)".
- **Self-contained:** embed the images (base64; videos go beside the page as files, `<video src="flow.mp4" controls playsinline muted>`, which `ag-show` copies along and the phone link plays) so the file works anywhere, keep it in `/tmp/<topic>-review/index.html`, and `ag-show` it. Include the `phone:` link that `ag-show` prints in your message, so he can also review and comment from his iPhone. Include the ticket/PR links and the diff size.
- **Link back to the session:** put a clickable link to the session that did the work at the top: its ag-dash link, `ag link` (label + URL) or `ag link --url` (just the URL, for the href), i.e. `http://ag:7376/<pi session id>`. It stays valid when the tab moves, hibernates or closes: the board opens the live session (reply, Open in tmux), or its transcript with Wake / Resume (see "Helper sessions and links" under Sessions).
