---
description: Install the T3 Code (Ag) Mac app build waiting for the client Mac once it's online and idle for 10 minutes
schedule: every 5min
kind: command
command: ~/t3code/ag/build-mac --install-pending
cwd: ~
timeout: 15min
enabled: false
---
`ag/build-mac` (the T3 fork at `~/t3code`, FORK.md "The Mac app") marks a build pending when the client Mac is
asleep or has had input in the last 10 minutes. This runs `ag/build-mac --install-pending` every 5 minutes and
installs the pending build once the client Mac is awake and idle for 10 minutes; with nothing pending it does nothing.
