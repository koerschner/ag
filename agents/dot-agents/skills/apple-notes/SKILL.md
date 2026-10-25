---
name: apple-notes
description: Read, search and write the user's Apple Notes from any ag machine with `ag-notes` (runs on ag-mac, which syncs Notes through iCloud): list and search notes, read one as Markdown, read handwriting (Pencil drawings come out as PNGs to look at), create notes, append text. Use whenever a task involves the user's notes, "my note", or something they wrote or drew in Notes; never open Notes through a screen.
---

# Apple Notes (`ag-notes`)

ag-mac is signed in to the user's Apple Account with Notes in iCloud, so it sees what their iPhone and
iPad see within seconds. `ag-notes` works from ag-engine or any ag machine: off the Mac it ships itself
to ag-mac (`ag-mac run python3 -`) and drives Notes.app with JXA (no screen, no CUA queue).

```sh
ag-notes folders                         # folders with note counts
ag-notes list [N] [--folder F]           # most recently edited: id, edited (Central), folder, title
ag-notes search <text> [N]               # title or text contains (case-insensitive)
ag-notes read <id|title> [--dir D]       # Markdown; images/drawings saved as PNGs and listed
ag-notes create <title> [--folder F] [text|-]   # new note (iCloud/Notes by default); prints id
ag-notes append <id|title> [text|-]      # add text at the end (plain-text notes only)
```

- **Handwriting:** Notes doesn't give scripts the text it recognizes in Pencil drawings. `read` saves
  each drawing as a PNG (default `~/inbox/notes/<title>/`); open it with the read tool and read it
  yourself. Drawings are not part of the note's plain text, so `search` won't find handwritten words.
- `append` refuses notes with drawings, images or attachments: Notes rewrites the whole body, which
  could damage them. Make a new note instead. Edit or delete the user's notes only when they ask.
- Locked notes can't be read. Recently Deleted is skipped. File attachments and scans aren't exported.
- Needs Automation → Notes for sshd-keygen-wrapper on ag-mac and iCloud → Notes on (both done
  2026-10-25). If Notes shows no iCloud folders, turn on System Settings → Apple Account → iCloud → Notes
  on ag-mac (an `ag cua` task).
