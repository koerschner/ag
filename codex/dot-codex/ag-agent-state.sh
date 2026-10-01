#!/bin/sh
# Reports this Codex session (its transcript/session id) to agd (ag-mux) on SessionStart, so AG Dash
# and the tickler can find it. Twin of pi/dot-pi/agent/extensions/ag-agent-state.ts. Design: docs/ag-mux.md.

set -eu

action="${1:-}"
hook_input_file="$(mktemp "${TMPDIR:-/tmp}/ag-codex-hook.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

case "$action" in
  session) ;;
  *) exit 0 ;;
esac

[ "${AG_MUX:-}" = "1" ] || exit 0
# AG_PANE_ID on panes agd made; TMUX_PANE (which agd also resolves) on older panes.
pane_id="${AG_PANE_ID:-${TMUX_PANE:-}}"
[ -n "$pane_id" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

AG_HOOK_ACTION="$action" AG_HOOK_INPUT_FILE="$hook_input_file" AG_HOOK_PANE="$pane_id" python3 - <<'PY'
import json
import os
import random
import socket
import time

source = "ag:codex"
action = os.environ.get("AG_HOOK_ACTION", "")
pane_id = os.environ.get("AG_HOOK_PANE")
socket_path = os.environ.get("AG_MUX_SOCKET") or os.path.expanduser("~/.local/state/ag-mux/agd.sock")
hook_input_file = os.environ.get("AG_HOOK_INPUT_FILE")

if not pane_id or not socket_path:
    raise SystemExit(0)

hook_input = {}
if hook_input_file:
    try:
        with open(hook_input_file, encoding="utf-8") as handle:
            content = handle.read()
        if content.strip():
            hook_input = json.loads(content)
    except Exception:
        hook_input = {}

hook_event_name = str(hook_input.get("hook_event_name") or "")
if hook_event_name and hook_event_name != "SessionStart":
    raise SystemExit(0)

request_id = f"{source}:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}"
report_seq = time.time_ns()
session_id = hook_input.get("session_id")
agent_session_id = session_id if isinstance(session_id, str) and session_id else None
transcript_path = hook_input.get("transcript_path")
if not isinstance(transcript_path, str) or not transcript_path.strip():
    raise SystemExit(0)
inherited_session_id = os.environ.get("CODEX_THREAD_ID")
if inherited_session_id and inherited_session_id != agent_session_id:
    raise SystemExit(0)
session_start_source = hook_input.get("source") if hook_event_name == "SessionStart" else None
if not isinstance(session_start_source, str) or not session_start_source:
    session_start_source = None
if agent_session_id:
    params = {
        "pane_id": pane_id,
        "source": source,
        "agent": "codex",
        "seq": report_seq,
        "agent_session_id": agent_session_id,
    }
    if session_start_source:
        params["session_start_source"] = session_start_source
    request = {
        "id": request_id,
        "method": "pane.report_agent_session",
        "params": params,
    }
else:
    raise SystemExit(0)

try:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(0.5)
    client.connect(socket_path)
    client.sendall((json.dumps(request) + "\n").encode())
    try:
        client.recv(4096)
    except Exception:
        pass
    client.close()
except Exception:
    pass
PY
