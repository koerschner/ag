---
name: google-slides
description: Read and edit the user's Google Slides decks with `ag-gslides`. It calls the Google Slides API from any ag machine as their work Google account. You can list slides and their text, list layouts, run batch updates (new slides, text, bullets, styles), and render every slide to PNG. Use this instead of computer use whenever a task involves a Google Slides deck or a docs.google.com/presentation link.
---

# Google Slides (`ag-gslides`)

`ag-gslides` calls the Google Slides API as the user's work Google account (`AG_WORK_GOOGLE_ACCOUNT` in the private env file) with the `presentations` scope. It can reach every deck that account can open. The OAuth client is the Desktop client "ag-gcal" in the Google Cloud project `ag-calendar-nk`, where the Slides API is enabled. The client and refresh token live in op-work, item "ag-gslides Google Slides OAuth" (vault ag-vault). Only the 1-hour access token is cached in `~/.cache/ag-gslides/`.

```sh
ag-gslides get <deck> [--json]      # title, then every slide: object id, layout, shapes and their text
ag-gslides layouts <deck>           # layout object ids (for createSlide) and their placeholders
ag-gslides batch <deck> req.json    # presentations.batchUpdate; {"requests": [...]} or a bare list; "-" = stdin
ag-gslides thumbs <deck> [DIR]      # PNG of every slide (default /tmp/ag-gslides-<deck id>/)
```

- `<deck>` is the presentation id or its docs.google.com URL.
- Make edits with `batch` using Slides API requests (`createSlide` with a `layoutId` from `layouts` and `placeholderIdMappings`, `insertText`, `createParagraphBullets`, `updateTextStyle`, `deleteObject`, and others). Read the deck with `get` first. After editing, run `thumbs` and look at the PNGs to check your work.
- Edit only the decks the user asked about. Save a copy with `get --json` before you delete or rewrite existing slides.
- This tool cannot rename, share, or move files. Those actions need the Drive API.
- If a call fails with `invalid_grant`, the token was revoked. Run `ag-gslides auth` on ag-mac. It reads the OAuth client from op-shared and listens on 127.0.0.1:8766. Then use `ag cua` to finish the consent screen in ag-mac's Chrome as the work account. The app is unverified, so click Advanced and then Go to … (unsafe).
