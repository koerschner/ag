# iOS Shortcut: ag Button / Capture / Voice to ag (Action Button, screenshot, offline queue)

The iPhone Action Button runs **ag Button**, built from Federico Viticci's **MultiButton** template
(MacStories, https://www.icloud.com/shortcuts/117fb2566cf245ff8a2c5b60cbb8c4f8):
- **One press**: grabs a screenshot and opens the "Capture" text box (**Capture to ag**). Type, tap Done.
- **Second press within 3 seconds**: runs **Voice to ag**, which starts recording right away with the
  first press's screenshot. Tap the screen to finish; the recording is sent to ag, transcribed with
  Whisper (TrueFoundry), and the transcript becomes the prompt.

Either way the capture becomes a new pi session in the **Inbox** workspace via the ag inbox
(`ag-inbox`, port 7373, Tailscale only). This is the GTD inbox capture point.

How the double press works: iOS has no native double press, and **the Action Button ignores a second
press while the first shortcut is still running** (MultiButton's own caveat). So a run that keeps the
text box open can never see a second press. MultiButton stores the time of the last press in
`iCloud Drive/Shortcuts/MultiButton.json`; a press within 3 s of it takes the secondary branch. ag Button's
primary branch doesn't run Capture to ag inside itself: it saves the screenshot as `ag-state/shot.jpg`,
clears any stale `ag-state/double.txt`, and opens `shortcuts://run-shortcut?name=Capture%20to%20ag`, so
the Action Button run ends at once and the button is free again. The secondary branch saves
`ag-state/double.txt` and runs Voice to ag with `shot.jpg` as input. Capture to ag uses `shot.jpg` when it
was created in the last 15 s (otherwise it takes its own screenshot); if its text box is still up after
a voice capture, tapping Done or Cancel on it discards it (it sees `double.txt`).

iPhone Mirroring can't use the phone's microphone or press the Action Button, so voice capture
and real button presses can only be tested on the physical phone.

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
    A[Action Button → ag Button] --> M{"MultiButton.json lastRun < 3 s ago?"}
    M -- "no (1st press)" --> P["Take Screenshot → JPEG → ag-state/shot.jpg<br/>delete ag-state/double.txt<br/>Open URL shortcuts://run-shortcut?name=Capture to ag<br/>save lastRun → run ends"]
    M -- "yes (2nd press)" --> S["Save ag-state/double.txt, save lastRun<br/>Run Voice to ag (input: ag-state/shot.jpg)"]
    P --> C0["Capture to ag: Shot = ag-state/shot.jpg if < 15 s old, else Take Screenshot"]
    C0 --> B["Ask for Input (Text) 'Capture'"]
    B --> C4{"ag-state/double.txt exists?"}
    C4 -- yes --> C5["Delete it → Stop (discard)"]
    C4 -- no --> D["Save Date.txt and Date.jpg → ag-queue/"]
    D --> F["Run Shortcut: Flush ag Queue"]

    S --> V0["Voice to ag: Shot = input, or Take Screenshot → JPEG if run directly"]
    V0 --> V4["Record Audio: Immediately, finish On Tap"]
    V4 --> V7{"Duration < 1 s?"}
    V7 -- yes --> V8["Stop (discard)"]
    V7 -- no --> V9["Save Date.m4a and Date.jpg → ag-queue/"]
    V9 --> F

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
3. Shortcut **ag Button** (Action Button): import MultiButton from the link above, answer its setup
   question with `Capture to ag` and `Voice to ag`, rename it, then change only:
   - Seconds: the Number action **and** the literal in "If Time Elapsed From Last Run is less than …": `3`.
   - Secondary branch, before **Run Shortcut** [Second Shortcut]: **Get File from Folder** `ag-state/shot.jpg`
     (Error If Not Found off) → **Text** `1` → **Set Name** `double.txt` → **Save File** subpath `ag-state/`
     (Ask off, Overwrite on); the Run Shortcut's input = the shot.jpg File.
   - Primary branch: replace **Run Shortcut** [First Shortcut] with **Take Screenshot** → **Convert Image**
     JPEG → **Set Name** `shot.jpg` → **Save File** subpath `ag-state/` → **Get File from Folder**
     `ag-state/double.txt` → **If** has any value → **Delete Files** → **End If** →
     **Open URLs** `shortcuts://run-shortcut?name=Capture%20to%20ag`. Keep MultiButton's lastRun saves.
   Shortcut **Capture to ag** (typed):
   1. **Get File from Folder**: `ag-state/shot.jpg` (Error If Not Found off) → **Get Details of Files**: Date Created.
   2. **If** (All) File has any value and Date Created is in the last 15 seconds → **Set Variable** *Shot* = File;
      **Otherwise** → **Take Screenshot** → **Convert Image** JPEG → **Set Variable** *Shot*. **End If**.
   3. **Ask for Input**: Text, prompt "Capture", multiple lines.
   4. **Get File from Folder**: `ag-state/double.txt` (Error If Not Found off) → **If** has any value
      → **Delete Files** → **Stop This Shortcut** → **End If**.
   5. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   6. **Set Name**: Provided Input → `<Formatted Date>.txt` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   7. **Set Name**: *Shot* → `<Formatted Date>.jpg` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   8. **Run Shortcut**: Flush ag Queue. No Show Notification action.
4. Shortcut **Voice to ag** (double press; accepts Images and Files as input):
   1. **If** Shortcut Input has any value → **Set Variable** *Shot* = Shortcut Input; **Otherwise** →
      **Take Screenshot** → **Convert Image** JPEG → **Set Variable** *Shot* = Converted Image. **End If**.
   2. **Record Audio**: Quality Normal, Start Recording **Immediately**, Finish Recording **On Tap**.
   3. **Get Details of Media**: Duration of Recorded Audio → **If** less than 1 → **Stop This Shortcut** → **End If**.
   4. **Format Date**: Current Date, Custom `yyyyMMdd-HHmmss-SSS`.
   5. **Set Name**: Recorded Audio → `<Formatted Date>.m4a` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   6. **Set Name**: *Shot* → `<Formatted Date>.jpg` → **Save File**: subpath `ag-queue/`, Ask off, Overwrite on.
   7. **Run Shortcut**: Flush ag Queue.
5. Automation → New → **Wi-Fi** → Any Network → **Is Joined** → **Run Immediately**
   → Run Shortcut **Flush ag Queue**.
6. First run: allow microphone, connecting to `100.107.192.32` → **Always Allow**, running
   other shortcuts → **Always Allow**; allow folder access and screenshots if asked.
7. Settings → **Action Button** → **Shortcut** → *ag Button*.

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
- 2026-09-30: swapped per Nathan: one press → typed Capture to ag (with screenshot), double press →
  Voice to ag. Both shortcuts rebuilt on the client Mac (verified in the editor). Still to do on the
  phone: set the Action Button to Capture to ag and test single/double press (Mirroring reported
  iPhone in Use).
- 2026-09-30 (later): the flag-based double press didn't work on the phone: the Action Button ignores a
  second press while the first run is still open. Rebuilt on MultiButton as **ag Button**, whose first
  press hands the text box to a separate run via a Shortcuts URL and exits. Action Button set to ag
  Button; single press verified through Mirroring (request `003e6664`). Double press needs a physical
  test (Mirroring can't press the Action Button; tapping the tile while Capture to ag is open in the
  Shortcuts app is blocked the same way).
