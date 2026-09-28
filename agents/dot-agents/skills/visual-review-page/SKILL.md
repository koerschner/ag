---
name: visual-review-page
description: Build a self-contained HTML review page showing every changed screen in context (storyboard, real renders, before/after) and open it on Nathan's screen. Use whenever work changes something people see (UI, dialogs, native alerts, emails, dashboards, copy) before asking him to approve it.
---

# Visual review pages

Whenever work changes something people see (UI screens, dialogs, native alerts, emails, dashboards, copy), give Nathan a review page before asking him to approve it: one self-contained HTML file that shows every changed screen **in context**, then open it on his screen with `show`. Screenshots in chat alone aren't enough.

- **In context:** for each screen, say who sees it, when, and what just happened (e.g. "Kid pressed Play with Roblox signed into the wrong account"), then the screenshot, then what they can do next. Order the screens as the user meets them, like a storyboard. Show the before next to the after when something existing changed.
- **Real renders, not mockups:** capture the actual component (Storybook stories plus headless Playwright; add a story when a state has none), the real native UI (render the actual `NSAlert` or window offscreen to PNG), or the running app. Mark anything that isn't the real render.
- **Self-contained:** embed the images (base64) so the file works anywhere, keep it in `/tmp/<topic>-review/index.html`, and `show` it. Include the `phone:` link that `show` prints in your message, so he can also review and comment from his iPhone. Include the ticket/PR links and the diff size.
- **Link back to the session:** put a clickable link to the session that did the work at the top: its ag board link, `herdr-link --session` (label + URL) or `herdr-link --url --session` (just the URL, for the href), i.e. `http://ag:7376/<pi session id>`. It stays valid when the tab moves, hibernates or closes: the board opens the live session (reply, Open in Herdr), or its transcript with Wake / Resume (see "Helper sessions and links" under Herdr).
