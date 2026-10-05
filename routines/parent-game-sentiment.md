---
description: Twice daily, summarize what parents tell the school's SMS assistant about the Arcade and video games; text the user
schedule: calendar *-*-* 00,12:00:00 America/Chicago
kind: prompt
cwd: ~
timeout: 20min
enabled: true
---
Read and follow ~/ag-personal/routines/parent-game-sentiment.md (the user's private routine instructions). If that file is missing, stop and report that the private ag-personal checkout is missing.
