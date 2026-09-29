# iOS Shortcut: Voice / Capture to ag (Action Button, screenshot, offline queue)

The iPhone Action Button runs **Voice to ag**: it grabs a screenshot of whatever is on screen,
then starts recording right away. Tap the screen (the recording sheet's stop) to finish; the
recording is sent to ag, transcribed with Whisper (TrueFoundry), and the transcript becomes the
prompt of a new pi session in Herdr's **Inbox** workspace via the ag inbox (`ag-inbox`, port 7373,
Tailscale only). This is the GTD inbox capture point.

Typed capture is still there: **Capture to ag** (screenshot, then "Capture" text box). Voice to ag
hands off to it in two cases:
- **Quick double press**: each press saves a flag, `ag-state/pressed.txt`, just before recording.
  A press that finds a flag created in the last 2 seconds is the second press: it saves
  `ag-state/double.txt` and opens Capture to ag. The first press's recording sheet is still up
  underneath; when it's stopped, it sees `double.txt` and discards the recording. A stale flag
  (older than 2 s) is ignored, so it never needs cleaning up.
- **Recording shorter than 1 second** (press, then tap stop immediately).

Only the screenshot and two small iCloud file operations (read the flag, write it) run before
recording starts; converting and saving happen after the recording.

iOS limits: the Action Button starts a shortcut on press-and-hold but a shortcut can't detect the
release, so "hold to record, release to send" isn't possible; tap-to-finish is the closest. There is
no native double press either, hence the flag. iPhone Mirroring can't use the phone's microphone, so
voice capture can only be tested on the physical phone.

The screenshot is only handed to the agent when it's needed: Jev judges from the prompt
(transcript) whether it refers to what was on screen ("what song is this?" → attached; "remind me to
call mom Sunday" → not). The screenshot is always saved in `ag-mac:~/inbox/capture/` either way, and so
is the recording. Same gate as the Mac quick capture. If Jev judges the capture to be new context for a session that's already open, it's added to that session instead of opening a new one; see the README's "ag inbox" section.

Every capture is first saved to a queue folder on the phone (prompt as `<stamp>.txt` or
recording as `<stamp>.m4a`, screenshot as `<stamp>.jpg`, all in `ag-queue/`), then the queue is
flushed. If ag-mac is unreachable (bad signal, Tailscale down), the items stay queued and are sent on
the next capture or when the phone joins Wi-Fi. No success notification is shown. The server
ignores a repeated `id`, so resending an item whose response was lost is safe.

```mermaid
flowchart TD
    A[Action Button] --> V0["Take Screenshot<br/>Get ag-state/pressed.txt + its creation date"]
    V0 --> V1{"flag created < 2 s ago?"}
    V1 -- "yes (2nd press)" --> V2["Save ag-state/double.txt → Run Capture to ag → Stop"]
    V1 -- no --> V3["Save ag-state/pressed.txt"]
    V3 --> V4["Record Audio: Immediately, finish On Tap"]
    V4 --> V5{"ag-state/double.txt exists?"}
    V5 -- yes --> V6["Delete it → Stop (discard recording)"]
    V5 -- no --> V7{"Duration < 1 s?"}
    V7 -- yes --> V8["Run Capture to ag → Stop"]
    V7 -- no --> V9["Convert screenshot → JPEG<br/>Save Date.m4a and Date.jpg → ag-queue/"]
    V9 --> F

    T["Capture to ag (typed)"] --> S["Take Screenshot → JPEG"]
    S --> B["Ask for Input (Text) 'Capture'"]
    B --> D["Save Date.txt and Date.jpg → ag-queue/"]
    D --> F["Run Shortcut: Flush ag Queue"]

    W["Automation: Wi-Fi joins any network<br/>(Run Immediately)"] --> F
    F --> G["Get Contents of Folder: ag-queue<br/>Filter Files: extension is txt OR m4a"]
    G --> H{"Repeat with Each file"}
    H --> N["Name = file name without extension<br/>Get File from Folder: ag-queue/Name.jpg (Error If Not Found off) → Shot"]
    N --> I["Get Contents of URL<br/>POST http://100.107.192.32:7373/prompt<br/>Form: text = file (File), id = Name, source = iphone, screenshot = Shot"]
    I -- "success" --> J["Delete Files: file; Shot if its extension is jpg"]
    I -- "offline: shortcut stops,<br/>files stay queued" --> K[Retry later]
```

The flush sends every queued file as the form field `text` with type **File**: ag-inbox reads a
`.txt` as the prompt and treats an audio file (`.m4a`/`.caf`/`.wav`/…) as a voice recording.

## Build steps

1. In Files, create the folders **iCloud Drive › Shortcuts › ag-queue** and **Shortcuts › ag-state**.
   (The older `ag-queue/shots` folder is no longer used.)
2. Shortcut **Flush ag Queue**:
   1. **Get Contents of Folder**: ag-queue (Recursive off).
   2. **Filter Files**: Folder Contents where **Any** of: **File Extension** is `txt`; **File Extension** is `m4a`.
   3. **Repeat with Each** item in Files:
      - **Get Details of Files**: **Name** of Repeat Item (variable *Name*).
      - **Get File from Folder**: Shortcuts folder, path `ag-queue/[Name].jpg`,
        **Error If Not Found** off (variable *Shot*).
      - **Get Contents of URL**: `http://100.107.192.32:7373/prompt`; Method **POST**,
        Request Body **Form**; `text` (**File**) = **Repeat Item**; `id` (Text) = *Name*;
        `source` (Text) = `iphone`; `screenshot` (File) = *Shot*.
      - **Delete Files**: Repeat Item; **Delete Immediately** off (files go to Recently Deleted;
        this iOS version shows no confirmation toggle).
      - **If** *Shot* › **File Extension** is `jpg` → **Delete Files**: *Shot* (Delete Immediately off).
        **End If**. (Testing the extension, not "has any value", so a failed lookup can never delete a folder.)
3. Shortcut **Capture to ag** (typed):
   1. **Take Screenshot** (first, so it captures the screen before any prompt appears).
   2. **Convert Image**: Screenshot → JPEG (keeps the upload small on cellular).
   3. **Ask for Input**: Text, prompt "Capture".
   4. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   5. **Set Name**: Provided Input → `<Formatted Date>.txt`.
   6. **Save File**: Renamed Item → Shortcuts folder, subpath `ag-queue/`; Ask Where to Save off; Overwrite on.
   7. **Set Name**: Converted Image → `<Formatted Date>.jpg`.
   8. **Save File**: Renamed Item → Shortcuts folder, subpath `ag-queue/`; Ask Where to Save off; Overwrite on.
   9. **Run Shortcut**: Flush ag Queue.
   No Show Notification action.
4. Shortcut **Voice to ag** (Action Button):
   1. **Take Screenshot** (Full Screen).
   2. **Get File from Folder**: Shortcuts, `ag-state/pressed.txt`, Error If Not Found off.
   3. **Get Details of Files**: Date Created of File.
   4. **If** File has any value **and** Date Created is in the last 2 seconds → **Text** `1` →
      **Set Name** `double.txt` → **Save File**: subpath `ag-state/` (Ask off, Overwrite on) →
      **Run Shortcut**: Capture to ag → **Stop This Shortcut** → **End If**.
   5. **Text** `1` → **Set Name** `pressed.txt` → **Save File**: subpath `ag-state/`, Ask off,
      Overwrite on. (A Text item always gets a `.txt` name, so flags live outside `ag-queue` or the
      flush would send them.)
   6. **Record Audio**: Quality Normal, Start Recording **Immediately**, Finish Recording **On Tap**.
   7. **Get File from Folder**: `ag-state/double.txt` (Error If Not Found off) → **If** has any value
      → **Delete Files** → **Stop This Shortcut** → **End If**.
   8. **Get Details of Music/Media**: Duration of Recorded Audio → **If** Duration is less than 1
      → **Run Shortcut**: Capture to ag → **Stop This Shortcut** → **End If**.
   9. **Convert Image**: Screenshot → JPEG.
   10. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   11. **Set Name**: Recorded Audio → `<Formatted Date>.m4a` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   12. **Set Name**: Converted Image → `<Formatted Date>.jpg` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   13. **Run Shortcut**: Flush ag Queue.
5. Automation → New → **Wi-Fi** → Any Network → **Is Joined** → **Run Immediately**
   → Run Shortcut **Flush ag Queue**.
6. First run: allow microphone, connecting to `100.107.192.32` → **Always Allow**, running
   other shortcuts → **Always Allow**; allow folder access and screenshots if asked.
7. Settings → **Action Button** → **Shortcut** → *Voice to ag*.

Offline, the flush step shows iOS's own "could not connect" error; the item is still
queued. Test without the phone:
`curl -X POST http://ag:7373/prompt --data-urlencode 'text=hello' -d id=test1` → redirect/`202`;
repeating it with the same `id` within 24 h logs `duplicate` and opens nothing.
Voice without opening anything:
`say -o /tmp/v.m4a --data-format=aac 'what song is this'; curl -F dry=1 -F text=@/tmp/v.m4a http://ag:7373/prompt`.
Screenshot gate without opening anything:
`curl -F dry=1 -F 'text=what song is this' -F screenshot=@shot.png -F source=iphone http://ag:7373/prompt | jq -r .prompt`.

## Status

Claude (anthropic-primary/claude-opus-5-5), assisting Nathan:

- 2026-09-27: Capture to ag built and verified (request `5e879379` landed in Inbox).
- 2026-09-27 (evening): Voice to ag added and set as the Action Button; Flush and Capture moved
  screenshots into `ag-queue/` after the `shots/` folder went missing (phone captures had been
  arriving without screenshots). Server side verified with synthetic recordings (transcript →
  prompt, screenshot gate, queued `.txt`/`.m4a` as `text` files). Still to verify on the physical
  phone: a real voice capture end to end, and whether a second Action Button press during a
  recording starts the typed capture.
- 2026-09-27 (night): voice capture verified end to end on the phone. Rebuilt Voice to ag for a fast
  single press (removed a 1 s wait and three iCloud file operations before recording) and a
  creation-date double-press check. Awaiting Nathan's physical single/double press test.
