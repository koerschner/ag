---
name: imessage
description: Read and send the user's iMessage/SMS from any ag machine with `ag-messages` (runs on ag-mac next to chat.db): recent and unread conversations, threads (group chats too), search, contact lookup by name, attachments, sending text and files. Use whenever a task involves the user's texts, someone's phone number, or messaging a person; never read Messages through the client's desktop.
---

# iMessage (`ag-messages`)

ag-mac is signed in to iMessage with the user's personal Apple ID, with Messages in iCloud (and SMS
forwarding from their iPhone), so it sees what their phone sees. `ag-messages` works from ag-engine or
any ag machine: off the Mac it ships itself to ag-mac (`ag-mac run python3 -`) and runs there, reading
`chat.db` directly and sending through Messages.app with AppleScript.

```sh
ag-messages chats [N] [--unread]        # recent conversations: time, who, chat id, [unread], last text
ag-messages thread <who> [N]            # last N messages, oldest first; 📎 attachment paths
ag-messages search <text> [N]           # case-insensitive, newest first, across all chats
ag-messages contact <name|phone|email>  # contacts and their handles
ag-messages send <who> [--file F]... [text]  # waits for chat.db and reports delivered / FAILED
ag-messages get <attachment path> [dir] # copy an attachment to this machine (HEIC → JPEG), prints path
ag-messages cat <attachment path>       # attachment bytes on stdout
```

- `<who>`: a phone or email, a chat id from `chats` (group chats have hex ids), a contact name, or
  a group chat's name. A name must match exactly one contact or group (an exact full name wins);
  otherwise it exits listing the candidates, so pick one and use its handle.
- Times are the user's local time (America/Chicago). `them`/name = incoming, `me` = sent by the user
  (from any of their devices, or by an agent).
- Contacts come from the client Mac's address book over SSH (ag-mac's own Contacts copy is stale),
  cached on ag-mac for an hour and used from cache when the client is offline.
- To look at a photo someone sent: `ag-messages get <path> /tmp` then read the JPEG.
- `--file` takes a path on the machine you run it from (it's copied to ag-mac first).
- Exit 255 = ag-mac unreachable (`ag-mac status`). A chat.db error = Full Disk Access lost (`ag-access`).
  A send that reports `FAILED (error N)` did not go out; a new number that isn't on iMessage is retried
  as SMS automatically.

## Sending: rules

- **Only send after the user has OKed the exact text** (or explicitly told you what to say). Otherwise
  show them the draft and wait.
- **Attribution first line** (global AI attribution rule): the message opens with
  `Claude (<$PI_MODEL>), assisting <user>:` on its own line, then the body (SMS has no quote format,
  so the body goes unquoted). The only exception is a draft they asked to send as themselves, in their voice.
- Test sends go only to the user's own number (from the personal instructions / `$AG_TEXT_NUMBER`).
