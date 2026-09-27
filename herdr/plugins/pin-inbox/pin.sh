#!/bin/sh
# Move the workspace labelled "Inbox" to the top if it isn't already. Moving it
# fires workspace.moved again, which is then a no-op.
herdr=${HERDR_BIN_PATH:-herdr}
first=$("$herdr" workspace list | /usr/bin/python3 -c '
import json, sys
ws = json.load(sys.stdin)["result"]["workspaces"]
inbox = [w for w in ws if w["label"].lower() == "inbox"]
if inbox and ws[0] is not inbox[0]:
    print(inbox[0]["workspace_id"])')
[ -n "$first" ] || exit 0
printf '{"id":"pin-inbox","method":"workspace.move","params":{"workspace_id":"%s","insert_index":0}}\n' "$first" \
  | nc -U -w 2 "$HERDR_SOCKET_PATH" >/dev/null
