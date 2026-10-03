---
description: An archived-while-working chat is Resolved (and closes) once its answer leaves nothing for me
on: answer
code: rule.ts
enabled: true
---
When I archive a chat in ag-dash while its agent is still working, it keeps running hidden. When it finishes,
judge its latest answer against my request: if the goal was met and nothing is left for me (no error, failure,
partial result, blocker, or question, request or review waiting on me), it's done, and ag-dash closes it.
Otherwise it needs me, and ag-dash brings it back pinned and unread.

Code: one Jev choice (done / needs_user) on the request and the answer.
