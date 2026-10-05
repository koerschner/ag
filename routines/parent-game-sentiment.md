---
description: Every 10 minutes, check what parents tell the school's SMS assistant about the Arcade and video games; text the user when anything new comes in
schedule: every 10min
kind: prompt
cwd: ~
timeout: 9min
enabled: true
---
Read and follow ~/ag-personal/routines/parent-game-sentiment.md (the user's private routine instructions). If that file is missing, stop and report that the private ag-personal checkout is missing.
