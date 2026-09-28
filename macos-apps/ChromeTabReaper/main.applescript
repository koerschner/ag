-- ChromeTabReaper.app: exists only so macOS can grant it Automation access to Google Chrome.
-- Everything else lives in ~/.local/bin/chrome-tab-reaper (its osascript inherits this app's grant).
do shell script "/usr/bin/python3 \"$HOME/.local/bin/chrome-tab-reaper\" _run >/dev/null 2>&1 &"
