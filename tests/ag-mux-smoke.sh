#!/usr/bin/env bash
# Smoke test for ag-mux on an isolated tmux server and state dir (never touches the real `tmux -L ag`).
#   tests/ag-mux-smoke.sh            topology, pane I/O, moves, events, snapshot shape, restore
#   AG_MUX_TEST_PI=1 tests/…         also start a Pi agent and prompt it (costs one tiny model call)
# Shape checks compare key sets against golden response fixtures (tests/fixtures), the contract scripts rely on.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bin=$here/../bin/dot-local/bin; export AG_MUX_LIB=$here/../bin/dot-local/lib/ag-mux
export AG_MUX_TMUX=agsmoke$$ AG_MUX_STATE=${TMPDIR:-/tmp}/agsmoke$$
export AG_MUX_SOCKET=$AG_MUX_STATE/agd.sock AG_MUX_CONF=$here/../tmux/dot-config/ag/ag.tmux.conf AG_MUX_BIN=$bin/ag-mux AG_MUX_SLEEP=$bin/ag-mux-sleep
M() { "$bin/ag-mux" "$@"; }
pass=0 failed=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; return 1; fi; }
keys() { jq -r "$1 | keys[]" | sort | tr '\n' ' '; }
cleanup() {
	[ -n "${agd:-}" ] && kill "$agd" 2>/dev/null
	tmux -L "$AG_MUX_TMUX" kill-server 2>/dev/null
	rm -rf "$AG_MUX_STATE"
}
trap cleanup EXIT
mkdir -p "$AG_MUX_STATE"
start() { "$bin/ag-mux" daemon >>"$AG_MUX_STATE/agd.log" 2>&1 & agd=$!; for _ in $(seq 50); do M status >/dev/null 2>&1 && break; sleep 0.1; done; }
start
echo "ag-mux smoke ($(tmux -V), socket $AG_MUX_TMUX)"
check "agd running" 'M status >/dev/null'
check "first tab created" '[ "$(M tab list | jq ".result.tabs | length")" = 1 ]'
check "one tmux session, named ag" '[ "$(tmux -L "$AG_MUX_TMUX" list-sessions -F "#{session_name}" | grep -v "^_")" = ag ]'

read -r T P < <(M tab create --cwd /tmp --label "Test Tab" --no-focus | jq -r '.result.tab.tab_id + " " + .result.root_pane.pane_id')
check "ids look like t/p ids" '[[ $T =~ ^t[0-9A-Z]+$ && $P =~ ^p[0-9A-Z]+$ ]]'
M pane run "$P" 'echo "id=$AG_PANE_ID env=$AG_MUX"; echo PROBE_DONE' >/dev/null
check "wait-output regex" 'M pane wait-output "$P" --regex "^PROBE_DONE$" --timeout 8000 >/dev/null'
check "pane env has its own id" 'M pane read "$P" --source recent-unwrapped | grep -q "id=$P env=1"'
S=$(M pane split "$P" --direction down --no-focus | jq -r .result.pane.pane_id)
tp=$(M pane get "$P" | jq -r .result.pane.tmux_pane)
tmux -L "$AG_MUX_TMUX" split-window -d -h -t "$tp"
sleep 1
R=$(M pane list | jq -r --arg t "$T" --arg a "$P" --arg b "$S" '.result.panes[] | select(.tab_id == $t and .pane_id != $a and .pane_id != $b) | .pane_id')
M pane run "$R" 'echo "raw=$AG_PANE_ID"' >/dev/null
check "plain tmux split gets ids (ag-mux-shell)" 'M pane wait-output "$R" --match "raw=$R" --timeout 5000 >/dev/null'
leaves=$(printf '{"method":"layout.export","params":{"tab_id":"%s"}}' "$T" | M _raw | jq '[.result.layout.root | .. | objects | select(.type == "pane")] | length')
check "layout tree has 3 leaves" '[ "$leaves" = 3 ]'
M pane send-keys "$P" ctrl+c >/dev/null && ok "send-keys ctrl+c" || bad "send-keys ctrl+c"
check "bad key rejected" '! M pane send-keys "$P" hyper+q 2>/dev/null'

# Events: subscribe, then move a pane into a tab of its own and rename a tab.
ev=$AG_MUX_STATE/events.txt
python3 - "$AG_MUX_SOCKET" >"$ev" <<'PY' &
import json, socket, sys, time
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.settimeout(6)
s.sendall((json.dumps({"id": "t", "method": "events.subscribe", "params": {"subscriptions": [{"type": t} for t in ("pane.moved", "tab.renamed", "tab.created", "pane.closed", "layout.updated")]}}) + "\n").encode())
end = time.time() + 5
buf = b""
while time.time() < end:
    try:
        d = s.recv(65536)
    except socket.timeout:
        break
    if not d: break
    buf += d
sys.stdout.write(buf.decode())
PY
sub=$!
sleep 0.5
mv=$(M pane move "$S" --new-tab --label "Split Out" --no-focus)
check "split pane moved to its own tab keeping its id" '[ "$(jq -r .result.move_result.pane.pane_id <<<"$mv")" = "$S" ] && [ "$(jq -r .result.move_result.pane.tab_id <<<"$mv")" != "$T" ]'
read -r T1 P1 < <(M tab create --no-focus | jq -r '.result.tab.tab_id + " " + .result.root_pane.pane_id')
mv2=$(M pane move "$P1" --new-tab --label "Filed" --no-focus)
check "single-pane tab move keeps tab id" '[ "$(jq -r .result.move_result.pane.tab_id <<<"$mv2")" = "$T1" ]'
check "moved tab labelled" '[ "$(M tab get "$T1" | jq -r .result.tab.label)" = Filed ]'
M tab rename "$T1" "Renamed" >/dev/null
wait "$sub"
check "events: pane_moved" 'grep -q "\"event\":\"pane_moved\"" "$ev"'
check "events: tab_renamed" 'grep -q "\"event\":\"tab_renamed\"" "$ev"'

# Response shapes vs the golden fixtures (every key there must be present here).
fx=$here/fixtures
sub_of() { comm -23 <(tr ' ' '\n' <<<"$1" | sort -u) <(tr ' ' '\n' <<<"$2" | sort -u) | grep -v '^$' | tr '\n' ' '; }
for c in "pane get|$P|.result.pane|pane-get.json" "tab get|$T|.result.tab|tab-get.json"; do
	IFS='|' read -r cmd id path file <<<"$c"
	missing=$(sub_of "$(keys "$path" <"$fx/$file")" "$(M $cmd "$id" | keys "$path")")
	missing=${missing//scroll /}; missing=${missing//agent_session /}; missing=${missing//agent /}
	check "shape: $cmd (missing: ${missing:-none})" '[ -z "${missing// /}" ]'
done
missing=$(sub_of "$(keys .result.snapshot <"$fx/snapshot.json")" "$(M api snapshot | keys .result.snapshot)")
check "shape: api snapshot (missing: ${missing:-none})" '[ -z "${missing// /}" ]'
missing=$(sub_of "$(keys .result.process_info <"$fx/process-info.json")" "$(M pane process-info --pane "$P" | keys .result.process_info)")
check "shape: process-info (missing: ${missing:-none})" '[ -z "${missing// /}" ]'

if [ "${AG_MUX_TEST_PI:-}" = 1 ]; then
	read -r _ AP < <(M tab create --cwd "$HOME" --no-focus | jq -r '.result.tab.tab_id + " " + .result.root_pane.pane_id')
	check "agent start pi" 'M agent start smoke --kind pi --pane "$AP" --timeout 60000 >/dev/null'
	check "agent reports its session file" 'M agent get smoke | jq -e ".result.agent.agent_session.value | endswith(\".jsonl\")" >/dev/null'
	check "agent prompt --wait" '[ "$(M agent prompt smoke "Reply with exactly: PONG" --wait --timeout 120000 | jq -r .result.agent.agent_status)" = done ]'
	check "agent read shows the answer" 'M agent read smoke --source recent --lines 40 | grep -q PONG'
	M agent send-keys smoke ctrl+c >/dev/null; M agent send-keys smoke ctrl+c >/dev/null; sleep 2
	check "agent released when pi exits" '! M agent get smoke >/dev/null 2>&1'
fi

# Sessions made outside agd (plain tmux, or left from before tabs were flattened) fold into ag, ids intact.
tmux -L "$AG_MUX_TMUX" new-session -d -s Stray -n "Stray Tab"
for _ in $(seq 20); do sleep 0.25; tmux -L "$AG_MUX_TMUX" has-session -t =Stray 2>/dev/null || break; done
check "stray session folded into ag" '! tmux -L "$AG_MUX_TMUX" has-session -t =Stray 2>/dev/null && M tab list | jq -e "[.result.tabs[].label] | index(\"Stray Tab\")" >/dev/null'
check "folded tab keeps its pane id" 'M pane list | jq -e "[.result.panes[] | select(.tab_id == \"$T\")] | length == 2" >/dev/null'

# Attach: each terminal gets its own grouped view of ag, which goes away on detach.
(TERM=xterm-256color timeout 4 script -qfc "env -u TMUX -u AG_MUX $bin/ag-mux attach" /dev/null >/dev/null 2>&1 &)
sleep 1.5
check "attach makes a grouped view that isn't folded" '[ "$(tmux -L "$AG_MUX_TMUX" list-sessions -F "#{session_group}" | grep -c "^ag$")" = 2 ] && [ "$(M tab list | jq ".result.tabs | length")" = "$(tmux -L "$AG_MUX_TMUX" list-windows -t ag | wc -l)" ]'
sleep 3.5
check "the view goes away on detach" '[ "$(tmux -L "$AG_MUX_TMUX" list-sessions -F "#{session_group}" | grep -c "^ag$")" -le 1 ]'

# Restore: kill tmux + agd, restart, expect the same tab ids back.
before=$(M api snapshot | jq -c '[.result.snapshot.tabs[].tab_id] | sort')
M save >/dev/null
kill "$agd"; wait "$agd" 2>/dev/null
tmux -L "$AG_MUX_TMUX" kill-server
for _ in $(seq 50); do tmux -L "$AG_MUX_TMUX" ls >/dev/null 2>&1 || break; sleep 0.1; done
start
after=$(M api snapshot | jq -c '[.result.snapshot.tabs[].tab_id] | sort')
check "restore brings back every tab id" '[ "$before" = "$after" ]'
check "restore keeps labels" 'M tab get "$T1" | jq -e ".result.tab.label == \"Renamed\"" >/dev/null' ||
	{ echo "  saved:"; jq -c '[.tabs[] | [.id, .label]]' "$AG_MUX_STATE/layout.json"; echo "  now: $after"; M tab list | jq -c "[.result.tabs[].tab_id]"; tmux -L "$AG_MUX_TMUX" list-windows -a -F "  #{session_name} #{@ag_tab} #{window_name} #{pane_current_command} #{pane_dead}"; tail -25 "$AG_MUX_STATE/agd.log"; }
tmux -L "$AG_MUX_TMUX" kill-server
for _ in $(seq 40); do sleep 0.25; tmux -L "$AG_MUX_TMUX" has-session -t =ag 2>/dev/null && M tab get "$T1" >/dev/null 2>&1 && break; done
check "agd restarts a dead tmux server and restores" 'tmux -L "$AG_MUX_TMUX" has-session -t =ag && M tab get "$T1" | jq -e ".result.tab.label == \"Renamed\"" >/dev/null'
T2=$(M tab create --label New --no-focus | jq -r .result.tab.tab_id)
check "new ids after restore don't collide" '[ -n "$T2" ] && ! grep -q "\"$T2\"" <<<"$before"'

# A version-1 layout (tabs grouped under workspaces, from before the flattening) restores flat.
cat >"$AG_MUX_STATE/v1.json" <<'JSON'
{"version":1,"workspaces":[{"id":"w9","label":"Inbox","order":1,"tabs":[{"id":"w9:tV1","label":"Old Inbox Tab","root":{"type":"pane","pane_id":"w9:pV1","cwd":"/tmp"}}]},
 {"id":"wA","label":"Topic","order":2,"tabs":[{"id":"wA:tV2","label":"Old Topic Tab","root":{"type":"pane","pane_id":"wA:pV2","cwd":"/tmp"}}]}]}
JSON
M restore --from "$AG_MUX_STATE/v1.json" >/dev/null
check "v1 layout restores its tabs with their ids" 'M tab get "w9:tV1" | jq -e ".result.tab.label == \"Old Inbox Tab\"" >/dev/null && M pane get "wA:pV2" >/dev/null'
check "still one tmux session" '[ "$(tmux -L "$AG_MUX_TMUX" list-sessions -F "#{session_name}" | grep -vc "^_")" = 1 ]'

echo "$pass passed, $failed failed"
[ "$failed" = 0 ]
