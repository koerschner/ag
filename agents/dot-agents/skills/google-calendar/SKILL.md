---
name: google-calendar
description: Read and write the user's Google Calendar with `ag-gcal` (Google Calendar API, from any ag machine, ~0.3 s a call): list calendars, show events for a range, search, get, create, move/update and delete events. "Actual" is the primary calendar; their work calendar is shared in read-only. Use whenever a task involves the user's schedule, calendar, availability, appointments or meetings.
---

# Google Calendar (`ag-gcal`)

`ag-gcal` talks to the Google Calendar API directly as the user's personal Google account, with full
calendar scope. Credentials (OAuth client + refresh token) are in op-shared, item
"ag-gcal Google Calendar OAuth"; off ag-mac the script reads them through `ag-mac run op-shared` and
caches only the 1-hour access token in `~/.cache/ag-gcal/`.

```sh
ag-gcal calendars                               # id, access, name
ag-gcal events [FROM] [TO] [--cal C] [-q TEXT]  # default today .. +7d; times in Central
ag-gcal get <id> [--cal C]                      # full JSON (attendees, description, links)
ag-gcal create <title> <start> [<end>] [--cal C] [--desc D] [--where W] [--all-day]
ag-gcal update <id> [--title T] [--start S] [--end E] [--desc D] [--where W] [--cal C]
ag-gcal delete <id> [--cal C]
```

- Calendars: `primary` = **Actual** (default; the user's real schedule), plus Ideal, Connections,
  Location, Work Hours, … by name. The work calendar (`nathaniel.koerschner@superbuilders.school`
  style id, see `calendars`) is **read-only** here: use it to see meetings, never to write.
- Times: `today`, `tomorrow`, `+3d`, `2026-10-26`, `2026-10-26 14:00`, or GNU `date -d` phrases
  ("tomorrow 3pm", "next friday 9:30"). A date alone means an all-day event. `update --start` keeps the
  duration. Recurring events show one instance per occurrence (ids with a `_<time>` suffix).
- Create, move and delete only what the user asked for; confirm before deleting anything they made.
- If calls fail with `invalid_grant`, the token was revoked: on ag-mac, download a client JSON for the
  Desktop client "ag-gcal" (Google Cloud project `ag-calendar-nk`, Google Auth Platform → Clients),
  run `ag-gcal auth <json>` there (it listens on 127.0.0.1:8765) and finish consent in ag-mac's Chrome
  with `ag cua` (the app is unverified: Advanced → Go to ag calendar).
