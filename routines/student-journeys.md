---
description: Write yesterday's private FreeTime student-journey report (XP, visits, summaries) and text the user its phone link
schedule: daily 06:30
kind: command
command: bun ~/ag-personal/student-journey/journey.ts --max-usd 40 --publish --text
cwd: ~/ag-personal/student-journey
timeout: 90min
enabled: true
---
Private code and docs: ~/ag-personal/student-journey/README.md (the user's private repo).
