Use computer use to build an iOS Shortcut on my iPhone through the iPhone Mirroring app on this Mac.

Build it exactly as specified in this doc (read it first; it's the source of truth):
https://github.com/koerschner/ag/blob/main/ios-shortcuts/send-to-ag.md (private)
(also at ~/ag/ios-shortcuts/send-to-ag.md on this Mac)

Summary: a share-sheet Shortcut named "Send to ag" that fetches http://ag.tail44736d.ts.net:7374/sessions (a
dictionary of label → id), lets me choose a destination from its keys, asks for an optional message,
then POSTs a form to http://ag.tail44736d.ts.net:7374/send with fields f (Shortcut Input file), text (message),
to (chosen dictionary value), and shows the response as a notification.

Test: in Photos, share the most recent screenshot to "Send to ag", choose "Just save", message "cua test".
If iOS asks to allow connecting to ag.tail44736d.ts.net, choose "Always Allow". Success = a notification like
"1 file(s), saved". Report exactly what happened, and any step where the built shortcut differs from the doc.

Notes:
- ag.tail44736d.ts.net is my dev Mac's Tailscale IP. If requests fail with a network error, check the Tailscale
  app on the iPhone is connected and tell me; don't change Tailscale settings.
- Typing into iPhone Mirroring can silently fail. If text doesn't appear, type it into a new temporary
  TextEdit document on this Mac, copy with Cmd+A / Cmd+C, then in iPhone Mirroring right-click the field
  and choose Paste. Verify each field's value in a screenshot before moving on. Discard the temp document.
- If Mirroring says "iPhone in Use", stop and tell me to lock my phone.
- Don't change anything else on the phone.
