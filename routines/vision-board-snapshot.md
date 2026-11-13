---
description: Nightly snapshot of the user's Freeform vision board; saves a dated copy when it changed and updates its timeline page
schedule: daily 23:07
kind: command
command: uv run --quiet ~/ag-personal/vision-board/snapshot.py
cwd: ~/ag-personal/vision-board
timeout: 15min
enabled: false
---
Private code and docs: ~/ag-personal/vision-board/README.md (the user's private repo). Exports the board with
`ag-freeform-export` (Freeform on ag-mac, via the screen queue).
