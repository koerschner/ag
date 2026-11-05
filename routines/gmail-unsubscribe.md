---
description: Nightly: unsubscribe from (or filter out) every sender the user tagged "Unsubscribe" in Gmail, in all their Google accounts
schedule: daily 03:17
kind: command
command: ag-gmail-unsub sweep
cwd: ~
timeout: 30min
enabled: true
---
Tag any email "Unsubscribe" in Gmail (personal or work account) and that sender is gone by morning: the sweep
unsubscribes from every mailing list the sender's service sends (one-click or mailto), filters the address out
when that isn't easily possible, and moves the mail to the "Unsubscribed" label. Details: `ag-gmail-unsub --help`.
