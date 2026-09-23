"""Herdr tab notification bubbles.

State per tab: the user's base label and the set of agent panes that went
done/blocked while the tab wasn't focused. The rendered label is
"<base> ●●". Visiting the tab (tab/pane/workspace focus) clears it.
"""

import fcntl
import json
import os
import subprocess
from pathlib import Path

DOT = "●"
ATTENTION = {"done", "blocked"}

HERDR = os.environ.get("HERDR_BIN_PATH", "herdr")
STATE_DIR = Path(os.environ.get("HERDR_PLUGIN_STATE_DIR") or Path(__file__).parent / ".state")
STATE = STATE_DIR / "state.json"


def herdr(*args):
    out = subprocess.run([HERDR, *args], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout).get("result")


def strip(label):
    return label.rstrip(DOT).rstrip()


def render(entry):
    n = len(entry["panes"])
    return f"{entry['base']} {DOT * n}" if n else entry["base"]


def main():
    event = os.environ.get("HERDR_PLUGIN_EVENT", "")
    data = json.loads(os.environ.get("HERDR_PLUGIN_EVENT_JSON") or "{}").get("data", {})

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_DIR / "lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
        before = {tid: render(e) for tid, e in state.items()}

        tabs = {t["tab_id"]: t for t in (herdr("tab", "list") or {}).get("tabs", [])}
        panes = {p["pane_id"]: p for p in (herdr("pane", "list") or {}).get("panes", [])}

        def entry(tab_id):
            if tab_id not in state:
                state[tab_id] = {"base": strip(tabs[tab_id]["label"]), "panes": []}
            return state[tab_id]

        def clear(tab_id):
            if tab_id in state:
                state[tab_id]["panes"] = []

        if event == "pane.agent_status_changed":
            pane = panes.get(data.get("pane_id"))
            if pane and pane["tab_id"] in tabs:
                tab_id = pane["tab_id"]
                if data.get("agent_status") in ATTENTION and not tabs[tab_id]["focused"]:
                    e = entry(tab_id)
                    if pane["pane_id"] not in e["panes"]:
                        e["panes"].append(pane["pane_id"])
                elif data.get("agent_status") == "working" and tab_id in state:
                    state[tab_id]["panes"] = [p for p in state[tab_id]["panes"] if p != pane["pane_id"]]
        elif event == "tab.focused":
            clear(data.get("tab_id"))
        elif event == "pane.focused":
            pane = panes.get(data.get("pane_id"))
            if pane:
                clear(pane["tab_id"])
        elif event == "workspace.focused":
            for tid, t in tabs.items():
                if t["focused"]:
                    clear(tid)
        elif event == "tab.renamed":
            tab_id, label = data.get("tab_id"), data.get("label", "")
            if tab_id in state and label != before.get(tab_id):
                state[tab_id]["base"] = strip(label)  # user rename; keep their name

        # Drop closed tabs/panes, then push any label changes.
        for tid in list(state):
            if tid not in tabs:
                del state[tid]
                continue
            state[tid]["panes"] = [p for p in state[tid]["panes"] if p in panes]
            label = render(state[tid])
            if label != tabs[tid]["label"]:
                herdr("tab", "rename", tid, label)
            if not state[tid]["panes"]:
                del state[tid]

        STATE.write_text(json.dumps(state))


main()
