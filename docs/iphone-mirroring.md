# Phone work via iPhone Mirroring

Anything that must happen **on the user's iPhone** (installing or configuring an app,
reading a token or setting, iOS Shortcuts, pairing) is done from the **client Mac**
through Apple's **iPhone Mirroring** app, driven with computer use from ag-mac:

```sh
ag cua --phone --why "<why it must happen on the phone>" "<what to do on the iPhone>"
```

- `--phone` (in Pi: `ag_cua` with `target: "phone"`) runs on the client Mac's desktop, not ag-mac's,
  because iPhone Mirroring is paired with the client Mac; it opens Mirroring for you first.
- The phone must be **locked** for Mirroring to connect. If it reports **iPhone in Use**,
  stop and ask the user to lock the phone, then retry. That is not a task failure.
- Don't ask the user to do phone steps by hand when Mirroring can do them. Stop only for
  Face ID/passcode prompts, purchases, or grants beyond the task.
- Secrets seen on the phone (tokens, pairing codes) go straight into a `chmod 600` file on
  the client (then `scp` to where they're used and delete). Never put them in reports,
  chat, or autosaving scratch documents.
- Record any resulting phone setting in the ag repo (README or `ios-shortcuts/`) so the phone
  can be rebuilt.

## Text entry

With `cua_repl`, `typeText`, ordinary `pressKey`, and direct `paste` can fail to reach the mirrored iPhone even when clicks and Mac shortcuts work. Check the phone screenshot before assuming text was entered. Tested fallback for non-secret text:

1. Create a new temporary TextEdit document through `cua_repl`; leave existing documents alone. Put the desired text in its editable field with `setValue` or `typeText`, focus it, then `pressKey("super+a")` and `pressKey("super+c")` to copy on the Mac.
2. In iPhone Mirroring, click the destination field near its insertion point, then `click([x, y], {mouseButton: "right"})` to open the iOS text-editing menu.
3. Read the fresh screenshot and click the visible **Paste** item. iOS may update after the initial capture; verify the actual field value in a follow-up screenshot before proceeding. This worked in Spotlight and Moshi's connection form.
4. Reuse only the temporary document for subsequent values and discard it afterward. Do not stage passwords, tokens, or private keys in TextEdit or another autosaving scratch document.

If Mirroring reports **iPhone in Use**, ask the user to leave the physical phone locked; reconnect after it is available. Do not mistake that disconnection for a text-entry failure. Keep requested onboarding pauses so the user can read each screen.

## Shortcuts: build on ag-mac, they sync to the phone

ag-mac's Shortcuts app is signed into the user's Apple ID with **iCloud Sync** on (Shortcuts ›
Settings › General, verified 2026-09-27; ag already lists Voice to ag, Capture to ag, Share to ag
and Flush ag Queue). So a shortcut built on ag-mac (with `ag-chatgpt-cua` in the Shortcuts app) appears on
the iPhone by itself; no second iPhone is needed. (`shortcuts list` on the CLI can show a stale
list; trust the app.) What does **not** sync and still needs the phone (via Mirroring): Back Tap
and Action Button assignments, personal automations (e.g. "Wi-Fi joins"), and iOS-only actions
that the Mac editor can't add (e.g. Take Screenshot, Record Audio settings) or test.
