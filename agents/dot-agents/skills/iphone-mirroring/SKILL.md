---
name: iphone-mirroring
description: Do anything on the user's iPhone (install or configure apps, pairing, reading a setting, iOS Shortcuts) by driving iPhone Mirroring on the client Mac. Use for any phone task instead of handing steps back to the user.
---

# Phone work (iPhone Mirroring)

For anything on the user's iPhone (install/configure apps, pairing, reading a setting, iOS Shortcuts), drive **iPhone Mirroring on the client Mac** with `ag-client-cua`; don't hand phone steps back to the user. Before doing phone work, read `~/ag/docs/iphone-mirroring.md`: locked-phone requirement, secret handling, and the tested text-entry workaround.

Mirroring only connects while the phone is locked and not in use. On **iPhone in Use**, notify the user right away so they lock it, don't just stall: `ssh ag-client "osascript -e 'display notification \"Please lock your iPhone so I can use iPhone Mirroring\" with title \"ag needs your phone\" sound name \"Glass\"'"` plus `ag-mux notification show "Lock your iPhone" --sound request`. Then retry every ~30s.
