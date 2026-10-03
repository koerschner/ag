---
description: A capture that continues an open session goes into it (or is pointed at it when unsure)
on: capture
code: rule.ts
enabled: true
---
When I send something to the ag-inbox (quick entry, the phone, ag-dash), check whether it refers back to work I
already have going and which open session it belongs to. If that's clear (it refers back to ongoing work with
p ≥ 0.7, and one session matches with p ≥ 0.8), deliver it into that session as new context. If it's only
plausible (≥ 0.5 and ≥ 0.3), open a new Inbox session that names the likely session, so the agent can forward
it there. Otherwise it's new work in a new session.

Code: one Jev call with two questions: a noul (does it refer back to ongoing work?) and a choice over the open
sessions (title, first and latest prompt) plus "none".
