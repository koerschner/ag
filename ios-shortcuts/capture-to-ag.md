# iOS Shortcuts: Voice to ag (Camera Control / Action Button) and Capture to ag (Home Screen)

Two separate shortcuts:
- **Voice to ag** runs from the **Camera Control** on the user's iPhone Duo (which has no Action Button) via a Magnifier automation, or from the **Action Button** on phones that have one. It grabs a screenshot, then recording starts right away. Tap the screen to finish. The recording is sent to ag, transcribed with Whisper (TrueFoundry), and the transcript becomes the prompt. **Tap right away (under 1 s) to type instead:** a "Type to ag" text box opens, and the typed text is sent with the same screenshot.
- **Capture to ag** is an icon on the **Home Screen** (page 2, top left): tap it, type in the
  "Capture" text box, tap Done. No screenshot.

Either way the capture becomes a new pi session, in the **Inbox** until you reply to it, via the ag-inbox
(`ag-inbox`, port 7373, Tailscale only). This is the GTD inbox capture point.

Why not one button for both: iOS has no double press for the Action Button, and it ignores a second
press while the first shortcut is still running. A flag-file double press and a MultiButton-based
version (2026-09-30) both failed on the phone, so they were dropped for two shortcuts.

iPhone Mirroring can't use the phone's microphone or press the Action Button, so voice capture
and real button presses can only be tested on the physical phone.

The screenshot is only handed to the agent when it's needed: Jev judges from the prompt
(transcript) whether it refers to what was on screen ("what song is this?" → attached; "remind me to
call mom Sunday" → not). The screenshot is always saved in `ag-mac:~/inbox/capture/` either way, and so
is the recording. Same gate as the Mac quick capture. If Jev judges the capture to be new context for a session that's already open, it's added to that session instead of opening a new one; see docs/reference.md, "ag-inbox" section.

Every capture is first saved to a queue folder on the phone (prompt as `<stamp>.txt` or
recording as `<stamp>.m4a`, screenshot as `<stamp>.jpg`, all in `ag-queue/`), then the queue is
flushed. If ag-mac is unreachable (bad signal, Tailscale down), the items stay queued and are sent on
the next capture or when the phone joins Wi-Fi. No success notification is shown. The server
ignores a repeated `id`, so resending an item whose response was lost is safe.

```mermaid
flowchart TD
    A[Camera Control or Action Button → Voice to ag] --> V0["Take Screenshot → JPEG"]
    V0 --> V4["Record Audio: Immediately, finish On Tap"]
    V4 --> V7{"Duration < 1 s?"}
    V7 -- yes --> V8["Ask for Input (Text) 'Type to ag'<br/>empty → stop"]
    V8 --> V8b["Save Date.txt and Date.jpg → ag-queue/"]
    V8b --> F
    V7 -- no --> V9["Save Date.m4a and Date.jpg → ag-queue/"]
    V9 --> F["Run Shortcut: Flush ag Queue"]

    H[Home Screen icon → Capture to ag] --> B["Ask for Input (Text) 'Capture'"]
    B --> D["Save Date.txt → ag-queue/"]
    D --> F

    W["Automation: Wi-Fi joins any network<br/>(Run Immediately)"] --> F
    F --> G["Get Contents of Folder: ag-queue<br/>Filter Files: extension is txt OR m4a"]
    G --> H{"Repeat with Each file"}
    H --> N["Name = file name without extension<br/>Get File from Folder: ag-queue/Name.jpg (Error If Not Found off) → Shot"]
    N --> I["Get Contents of URL<br/>POST http://ag.<tailnet>.ts.net:7373/prompt<br/>Form: text = file (File), id = Name, source = iphone, screenshot = Shot"]
    I -- "success" --> J["Delete Files: file; Shot if its extension is jpg"]
    I -- "offline: shortcut stops,<br/>files stay queued" --> K[Retry later]
```

The flush sends every queued file as the form field `text` with type **File**: ag-inbox reads a
`.txt` as the prompt and treats an audio file (`.m4a`/`.caf`/`.wav`/…) as a voice recording.

## Build steps

1. In Files, create the folder **iCloud Drive › Shortcuts › ag-queue**.
   (The older `ag-queue/shots` folder is no longer used.)
2. Shortcut **Flush ag Queue**:
   1. **Get Contents of Folder**: ag-queue (Recursive off).
   2. **Filter Files**: Folder Contents where **Any** of: **File Extension** is `txt`; **File Extension** is `m4a`.
   3. **Repeat with Each** item in Files:
      - **Get Details of Files**: **Name** of Repeat Item (variable *Name*).
      - **Get File from Folder**: Shortcuts folder, path `ag-queue/[Name].jpg`,
        **Error If Not Found** off (variable *Shot*).
      - **Get Contents of URL**: `http://ag.<tailnet>.ts.net:7373/prompt`; Method **POST**,
        Request Body **Form**; `text` (**File**) = **Repeat Item**; `id` (Text) = *Name*;
        `source` (Text) = `iphone`; `screenshot` (File) = *Shot*.
      - **Delete Files**: Repeat Item; **Delete Immediately** off (files go to Recently Deleted;
        this iOS version shows no confirmation toggle).
      - **If** *Shot* › **File Extension** is `jpg` → **Delete Files**: *Shot* (Delete Immediately off).
        **End If**. (Testing the extension, not "has any value", so a failed lookup can never delete a folder.)
3. Shortcut **Capture to ag** (Home Screen):
   1. **Ask for Input**: Text, prompt "Capture", multiple lines.
   2. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   3. **Set Name**: Provided Input → `<Formatted Date>.txt` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   4. **Run Shortcut**: Flush ag Queue. No Show Notification action.
   On the phone: Shortcuts app → long-press the tile → Share → **Add to Home Screen**.
4. Shortcut **Voice to ag** (Action Button; also accepts an image as input to use as the screenshot):
   1. **If** Shortcut Input has any value → **Set Variable** *Shot* = Shortcut Input; **Otherwise** →
      **Take Screenshot** → **Convert Image** JPEG → **Set Variable** *Shot* = Converted Image. **End If**.
   2. **Record Audio**: Quality Normal, Start Recording **Immediately**, Finish Recording **On Tap**.
   3. **Get Details of Media**: Duration of Recorded Audio → **If** less than 1 (quick tap = type instead):
      **Ask for Input** Text, prompt "Type to ag", multiple lines → **If** Provided Input does not have any
      value → **Stop This Shortcut** → **End If** → **Format Date** (Current Date, `yyyyMMdd-HHmmss-SSS`) →
      **Set Name** Provided Input → `<Formatted Date>.txt` → **Save File** `ag-queue/` (Ask off, Overwrite on) →
      **Set Name** *Shot* → `<Formatted Date>.jpg` → **Save File** `ag-queue/` → **Run Shortcut** Flush ag Queue →
      **Stop This Shortcut** → **End If**.
   4. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   5. **Set Name**: Recorded Audio → `<Formatted Date>.m4a` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   6. **Set Name**: *Shot* → `<Formatted Date>.jpg` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   7. **Run Shortcut**: Flush ag Queue.
5. Automation → New → **Wi-Fi** → Any Network → **Is Joined** → **Run Immediately**
   → Run Shortcut **Flush ag Queue**.
6. First run: allow microphone, connecting to `ag.<tailnet>.ts.net` → **Always Allow**, running
   other shortcuts → **Always Allow**; allow folder access and screenshots if asked.
7. Map the hardware button to *Voice to ag*:
   - **iPhone Duo (no Action Button):**
     - Settings → **Camera** → **Camera Control** → **Magnifier** (Single Click).
     - In Shortcuts, add a personal automation **When Magnifier is opened** (trigger: **App** → **Magnifier**, **Is Opened** only, run without asking, **Notify** off) with two actions: **Go to Home Screen**, then **Run Shortcut**: *Voice to ag*. One click of the Camera Control opens Magnifier, and the automation sends the phone to the Home Screen and starts *Voice to ag*.
     - **Consequences:** *Voice to ag*'s screenshot step now captures the Home Screen, not the app that was on screen when the button was pressed. Magnifier can't be used as an app while the automation is on, because opening it always starts *Voice to ag*.
     - **To undo:** turn the automation off, or set the Camera Control back to **Camera**.
   - **Phones with an Action Button:** Settings → **Action Button** → **Shortcut** → *Voice to ag*.

Offline, the flush step shows iOS's own "could not connect" error; the item is still
queued. Test without the phone:
`curl -X POST http://ag:7373/prompt --data-urlencode 'text=hello' -d id=test1` → redirect/`202`;
repeating it with the same `id` within 24 h logs `duplicate` and opens nothing.
Voice without opening anything:
`say -o /tmp/v.m4a --data-format=aac 'what song is this'; curl -F dry=1 -F text=@/tmp/v.m4a http://ag:7373/prompt`.
Screenshot gate without opening anything:
`curl -F dry=1 -F 'text=what song is this' -F screenshot=@shot.png -F source=iphone http://ag:7373/prompt | jq -r .prompt`.

## Status

Claude (anthropic-primary/claude-opus-5-5), assisting <user>:

- 2026-09-27: Capture to ag built and verified (request `5e879379` landed in Inbox).
- 2026-09-27 (evening): Voice to ag added and set as the Action Button; Flush and Capture moved
  screenshots into `ag-queue/` after the `shots/` folder went missing (phone captures had been
  arriving without screenshots). Server side verified with synthetic recordings (transcript →
  prompt, screenshot gate, queued `.txt`/`.m4a` as `text` files). Still to verify on the physical
  phone: a real voice capture end to end, and whether a second Action Button press during a
  recording starts the typed capture.
- 2026-09-27 (night): voice capture verified end to end on the phone. Rebuilt Voice to ag for a fast
  single press (removed a 1 s wait and three iCloud file operations before recording) and a
  creation-date double-press check. Awaiting the user's physical single/double press test.
- 2026-09-30: swapped per the user: one press → typed Capture to ag (with screenshot), double press →
  Voice to ag. Both shortcuts rebuilt on the client Mac (verified in the editor). Still to do on the
  phone: set the Action Button to Capture to ag and test single/double press (Mirroring reported
  iPhone in Use).
- 2026-09-30 (later): the flag-based double press didn't work on the phone: the Action Button ignores a
  second press while the first run is still open. Rebuilt on MultiButton as **ag Button**, whose first
  press hands the text box to a separate run via a Shortcuts URL and exits. Action Button set to ag
  Button; single press verified through Mirroring (request `003e6664`). Double press needs a physical
  test (Mirroring can't press the Action Button; tapping the tile while Capture to ag is open in the
  Shortcuts app is blocked the same way).
- 2026-09-30 (evening): the MultiButton double press didn't work on the phone either. Reverted per
  the user to two shortcuts: Voice to ag on the Action Button, Capture to ag on the Home Screen (page 2).
  ag Button deleted; Capture to ag's ag-state logic removed. Home Screen capture verified through
  Mirroring (request `ff84f981`).
- 2026-09-30: Capture to ag no longer takes a screenshot (text only), per the user.
- 2026-10-12: Voice to ag gained a typed path: a quick tap (<1 s) on the recording opens a "Type to ag"
  text box, sent with the screenshot. Edited on ag-mac (iCloud sync); server path verified with a dry run.
  Still to verify on the physical phone.
- 2026-10-26: The user's phone is now an iPhone Duo (no Action Button), so *Voice to ag* was moved to the Camera Control via a Magnifier automation. Camera Control and the automation were set up through iPhone Mirroring. Mirroring can't use the phone's camera (it shows "iPhone camera is not available from Mac"), and the automation didn't fire during the mirrored test, so a physical press still has to be tested on the phone. If a press only opens Magnifier, check that the automation runs immediately rather than after confirmation.
