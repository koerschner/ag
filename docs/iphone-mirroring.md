# Phone work via iPhone Mirroring

Anything that must happen **on Nathan's iPhone** (installing or configuring an app,
reading a token or setting, iOS Shortcuts, pairing) is done from the **client Mac**
through Apple's **iPhone Mirroring** app, driven with computer use from ag:

```sh
client-cua "Open iPhone Mirroring, connect to Nathan's iPhone, then ..."
```

- Use `client-cua` (client Mac desktop), not `chatgpt_cua`/`chatgpt-cua` (ag's desktop):
  iPhone Mirroring is paired with the client Mac.
- The phone must be **locked** for Mirroring to connect. If it reports **iPhone in Use**,
  stop and ask Nathan to lock the phone, then retry. That is not a task failure.
- Don't ask Nathan to do phone steps by hand when Mirroring can do them. Stop only for
  Face ID/passcode prompts, purchases, or grants beyond the task.
- Secrets seen on the phone (tokens, pairing codes) go straight into a `chmod 600` file on
  the client (then `scp` to where they're used and delete). Never put them in reports,
  chat, or autosaving scratch documents.
- Record any resulting phone setting in dotfiles (README or `ios-shortcuts/`) so the phone
  can be rebuilt.

## Text entry

With `cua_repl`, `typeText`, ordinary `pressKey`, and direct `paste` can fail to reach the mirrored iPhone even when clicks and Mac shortcuts work. Check the phone screenshot before assuming text was entered. Tested fallback for non-secret text:

1. Create a new temporary TextEdit document through `cua_repl`; leave existing documents alone. Put the desired text in its editable field with `setValue` or `typeText`, focus it, then `pressKey("super+a")` and `pressKey("super+c")` to copy on the Mac.
2. In iPhone Mirroring, click the destination field near its insertion point, then `click([x, y], {mouseButton: "right"})` to open the iOS text-editing menu.
3. Read the fresh screenshot and click the visible **Paste** item. iOS may update after the initial capture; verify the actual field value in a follow-up screenshot before proceeding. This worked in Spotlight and Moshi's connection form.
4. Reuse only the temporary document for subsequent values and discard it afterward. Do not stage passwords, tokens, or private keys in TextEdit or another autosaving scratch document.

If Mirroring reports **iPhone in Use**, ask Nathan to leave the physical phone locked; reconnect after it is available. Do not mistake that disconnection for a text-entry failure. Keep requested onboarding pauses so Nathan can read each screen.
