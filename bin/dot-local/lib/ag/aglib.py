"""Shared library for the `ag` session and system verbs (docs/ag-cli.md). Not a verb: no exec bit.

Session references (every verb that takes one): a pi session id, or a unique prefix/suffix of one; a session
file path; an ag-dash link (http://ag:7376/<sid> or …/t/<tab>); a tab id (t8, or older w1:tCW) or pane id (p4, w1:pCX); or a
label match (case-insensitive: exact first, then substring; ambiguous → error listing the candidates).
"me", "self" or "." (and the default) is the calling session, found by $PI_SESSION_ID / $PI_SESSION_FILE,
else by $TMUX_PANE; never $AG_TAB_ID, which goes stale when a pane moves to another tab. Everything is resolved fresh from
ag-mux's snapshot on each call, so stale pane ids can't happen.
"""

import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()


def personal_env(key, default=""):
    """A private value: $KEY, else its KEY= line in ~/ag-personal/env (the user's private repo; ag itself is public)."""
    if os.environ.get(key):
        return os.environ[key]
    try:
        for line in (HOME / "ag-personal/env").read_text().splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return default


def user_name():
    """The user's display name for attribution lines and notes: $AG_USER_NAME / ~/ag-personal/env, else "the user"."""
    return personal_env("AG_USER_NAME") or "the user"


SESSIONS = HOME / ".pi/agent/sessions"
AG_MUX = str(HOME / ".local/bin/ag-mux")
BOARD = os.environ.get("AG_DASH_URL", "http://127.0.0.1:7376")  # ag-dash; listens on loopback on the host
BOARD_PUBLIC = "http://ag:7376"  # links for people: the Tailscale Service, never a machine name
INBOX = os.environ.get("AG_INBOX_URL", "http://ag:7373/prompt")
SID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
SID_RE = re.compile(SID)


class AgError(Exception):
    pass


def die(msg, code=1):
    print(f"ag: {msg}", file=sys.stderr)
    sys.exit(code)


def run_main(fn):
    """Entry point wrapper: AgError → one clean line on stderr, exit 1."""
    try:
        sys.exit(fn(sys.argv[1:]) or 0)
    except AgError as e:
        die(str(e))
    except KeyboardInterrupt:
        sys.exit(130)
    except BrokenPipeError:
        sys.exit(0)


# ---------- small helpers ----------

def sid_of(s):
    m = SID_RE.search(os.path.basename(s or "")) or SID_RE.search(s or "")
    return m.group(0) if m else None


def mux(*args, check=True):
    r = subprocess.run([AG_MUX, *args], capture_output=True, text=True, timeout=60)
    if check and r.returncode != 0:
        try:
            msg = json.loads(r.stderr)["error"]["message"]
        except Exception:
            msg = (r.stderr or r.stdout).strip() or f"ag-mux {' '.join(args)} failed"
        raise AgError(msg)
    return r


def mux_json(*args):
    out = mux(*args).stdout
    return json.loads(out).get("result", {}) if out.strip() else {}


def http(method, url, body=None, ctype="application/json", timeout=30):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == "application/json" else str(body)).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": ctype} if data is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            msg = json.loads(raw).get("error") or raw
        except Exception:
            msg = raw
        raise AgError(f"{url.split('?')[0]}: HTTP {e.code}: {str(msg).strip()[:300]}")
    except urllib.error.URLError as e:
        raise AgError(f"{url.split('?')[0]} unreachable: {e.reason}")
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def board_state():
    return http("GET", f"{BOARD}/api/state")


def board_post(path, body):
    return http("POST", f"{BOARD}{path}", body)


def link(sid):
    return f"{BOARD_PUBLIC}/{sid}"


def phone_link(sid):
    suffix = None
    for ts in ("/usr/local/bin/tailscale", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"):
        if os.path.exists(ts):
            try:
                suffix = json.loads(subprocess.run([ts, "status", "--json"], capture_output=True, text=True, timeout=10).stdout)["MagicDNSSuffix"]
            except Exception:
                pass
            break
    suffix = suffix or os.environ.get("AG_TAILNET")  # e.g. tail1234.ts.net, when tailscale isn't reachable
    if not suffix:
        return link(sid)  # no tailnet name known: the MagicDNS short-name link still works on the tailnet
    return f"https://ag.{suffix}:7377/{sid}"


def ago(ts):
    if not ts:
        return "?"
    d = time.time() - ts
    for n, u in ((86400, "d"), (3600, "h"), (60, "m")):
        if d >= n:
            return f"{int(d // n)}{u} ago"
    return "just now"


def clip(s, n):
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


# Prompt origins (see pi/dot-pi/agent/extensions/ag-origin.ts): routing context wrapped in one tag the model reads
# and the UIs show as a chip. label = chip text; title + sid link to that session.
ORIGIN_RE = re.compile(r"<ag-origin\b([^>]*)>([\s\S]*?)</ag-origin>[ \t]*\n*")


def origin_tag(kind, label, note="", **attrs):
    from html import escape
    a = "".join(f' {k}="{escape(str(v))}"' for k, v in {"kind": kind, "label": label, **attrs}.items() if v)
    return f"<ag-origin{a}>{note.replace('</ag-origin>', '')}</ag-origin>"


def origins_of(text):
    """[{kind, label, title, sid, note, …}] for each origin tag in text."""
    from html import unescape
    out = []
    for m in ORIGIN_RE.finditer(text or ""):
        o = {k: unescape(v) for k, v in re.findall(r'(\w+)="([^"]*)"', m.group(1))}
        o["note"] = m.group(2).strip()
        out.append(o)
    return out


def strip_origins(text):
    return ORIGIN_RE.sub("", text or "").strip() if "<ag-origin" in (text or "") else text


def shq(s):
    return "'" + s.replace("'", "'\\''") + "'"


# ---------- session files ----------

def file_for_sid(sid):
    hits = glob.glob(str(SESSIONS / f"*/*_{sid}.jsonl"))
    return hits[0] if hits else None


def files_matching(part):
    """Session files whose id starts or ends with `part`."""
    out = {}
    for f in glob.glob(str(SESSIONS / f"*/*_*{part}*.jsonl")):
        s = sid_of(f)
        if s and (s.startswith(part) or s.endswith(part)):
            out[s] = f
    return out


def entries(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def file_meta(path):
    """Cheap facts about a session file: name (last session_info), first prompt, cwd, last activity."""
    name = first = cwd = None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i == 0:
                    try:
                        cwd = json.loads(line).get("cwd")
                    except ValueError:
                        pass
                if '"session_info"' in line:
                    try:
                        name = json.loads(line).get("name") or name
                    except ValueError:
                        pass
                elif first is None and '"role":"user"' in line:
                    try:
                        first = text_of(json.loads(line)["message"]["content"]).strip()
                    except (ValueError, KeyError):
                        pass
    except OSError:
        pass
    return {"name": name, "first": first, "cwd": cwd, "mtime": os.path.getmtime(path) if os.path.exists(path) else 0}


# ---------- the live index ----------

class Index:
    """One fresh snapshot of every tab/pane, joined with ag-dash's cards (best effort)."""

    def __init__(self, with_board=True):
        snap = mux_json("api", "snapshot")["snapshot"]
        self.tabs = {t["tab_id"]: t for t in snap["tabs"]}
        self.panes = {p["pane_id"]: p for p in snap["panes"]}
        self.cards = {}
        self.board = None
        if with_board:
            try:
                self.board = board_state()
                self.cards = {c["tab"]: c for c in self.board["cards"]}
            except AgError:
                pass
        self.by_sid = {}  # sid → pane (first pi pane holding it)
        for p in self.panes.values():
            f = (p.get("agent_session") or {}).get("value") or p.get("sleeping_session")
            s = sid_of(f)
            if s and s not in self.by_sid:
                self.by_sid[s] = p
        for c in self.cards.values():  # cards know sids the snapshot may not report yet
            if c.get("sid") and c["sid"] not in self.by_sid and c["pane"] in self.panes:
                self.by_sid[c["sid"]] = self.panes[c["pane"]]

    def session_for_pane(self, p):
        f = (p.get("agent_session") or {}).get("value") or p.get("sleeping_session")
        card = self.cards.get(p["tab_id"])
        s = sid_of(f) or (card or {}).get("sid")
        return self._make(p, s, f or (card or {}).get("sessionFile"))

    def _make(self, p, s, f=None):
        t = self.tabs.get(p["tab_id"], {})
        card = self.cards.get(p["tab_id"])
        return Session(
            sid=s, file=(f if f and os.path.exists(f) else (file_for_sid(s) if s else None)),
            tab=p["tab_id"], pane=p["pane_id"],
            title=re.sub(r"\s*●+\s*$", "", t.get("label") or (card or {}).get("title") or p["tab_id"]),
            state="hibernated" if p.get("sleeping_session") else "open", card=card, pane_count=t.get("pane_count", 1),
            agent_status=p.get("agent_status"),
        )

    def all_open(self):
        seen, out = set(), []
        for p in self.panes.values():
            if p["tab_id"] in seen:
                continue
            seen.add(p["tab_id"])
            out.append(self.session_for_pane(self._primary(p["tab_id"])))
        return out

    def _primary(self, tab):
        ps = [p for p in self.panes.values() if p["tab_id"] == tab]
        return next((p for p in ps if (p.get("agent_session") or {}).get("value") or p.get("sleeping_session")), ps[0])


class Session:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    @property
    def link(self):
        return link(self.sid) if self.sid else None

    def as_dict(self):
        d = {k: v for k, v in self.__dict__.items() if k != "card"}
        d["link"] = self.link
        if self.card:
            d.update(pinned=self.card.get("pinned"), needs_you=self.card.get("needsYou"), waiting=bool(self.card.get("waiting")), status=self.card.get("status"))
        return d


def closed_session(sid, f):
    m = file_meta(f)
    return Session(sid=sid, file=f, tab=None, pane=None,
                   title=m["name"] or clip(m["first"] or "(no prompt)", 70), state="closed", card=None, pane_count=0,
                   agent_status=None, mtime=m["mtime"])


def self_session(ix=None):
    ix = ix or Index()
    s = os.environ.get("PI_SESSION_ID") or sid_of(os.environ.get("PI_SESSION_FILE", ""))
    if s and s in ix.by_sid:
        return ix.session_for_pane(ix.by_sid[s])
    tp = os.environ.get("TMUX_PANE")
    if tp:
        p = next((p for p in ix.panes.values() if p.get("tmux_pane") == tp), None)
        if p:
            return ix.session_for_pane(p)
    if s:
        f = os.environ.get("PI_SESSION_FILE") or file_for_sid(s)
        if f:
            return closed_session(s, f)
    raise AgError("can't tell which session this is (no $PI_SESSION_FILE or $TMUX_PANE); pass one")


def resolve(ref=None, ix=None, allow_closed=True):
    """Resolve a session reference to a Session (see module docstring)."""
    ix = ix or Index()
    if ref in (None, "", "me", "self", "."):
        return self_session(ix)
    ref = ref.strip()
    m = re.search(r"/t/(w[\w]+:t[\w]+)", ref)
    if m:
        ref = m.group(1)
    if re.fullmatch(r"[tp][0-9A-Z]+", ref):  # bare tab/pane suffix: tCY → w1:tCY
        pool = ix.tabs if ref[0] == "t" else ix.panes
        hits = [k for k in pool if k.endswith(":" + ref)]
        if len(hits) == 1:
            ref = hits[0]
    if re.fullmatch(r"w\w+:t\w+", ref):
        if ref not in ix.tabs:
            raise AgError(f"no open tab {ref}")
        return ix.session_for_pane(ix._primary(ref))
    if re.fullmatch(r"w\w+:p\w+", ref):
        if ref not in ix.panes:
            raise AgError(f"no open pane {ref}")
        return ix.session_for_pane(ix.panes[ref])
    s = sid_of(ref)
    if s:
        if s in ix.by_sid:
            return ix.session_for_pane(ix.by_sid[s])
        f = ref if ref.endswith(".jsonl") and os.path.exists(ref) else file_for_sid(s)
        if not f:
            raise AgError(f"no session {s}")
        if not allow_closed:
            raise AgError(f"session {s} is closed (ag resume {s[-8:]} reopens it)")
        return closed_session(s, f)
    if re.fullmatch(r"[0-9a-f-]{4,35}", ref):
        live = {k: v for k, v in ix.by_sid.items() if k.startswith(ref) or k.endswith(ref)}
        if len(live) == 1:
            return ix.session_for_pane(next(iter(live.values())))
        if len(live) > 1:
            ambiguous(ref, [ix.session_for_pane(p) for p in live.values()])
        files = files_matching(ref)
        if len(files) == 1:
            s, f = next(iter(files.items()))
            if not allow_closed:
                raise AgError(f"session {s} is closed (ag resume {s[-8:]} reopens it)")
            return closed_session(s, f)
        if len(files) > 1:
            ambiguous(ref, [closed_session(s, f) for s, f in list(files.items())[:10]])
        if re.fullmatch(r"[0-9a-f]+", ref) is None:
            raise AgError(f"no session matches {ref}")
    # label match over open tabs
    q = ref.lower()
    sessions = ix.all_open()
    word = re.compile(r"\b" + re.escape(q), re.I)
    for test in (lambda s: s.title.lower() == q, lambda s: s.title.lower() == q, lambda s: word.search(s.title),
                 lambda s: q in s.title.lower(), lambda s: q in s.title.lower()):
        hits = [s for s in sessions if test(s)]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            ambiguous(ref, hits)
    raise AgError(f"no open session matches {ref!r} (ag find {shq(ref)} searches closed ones too)")


def ambiguous(ref, hits):
    lines = "\n".join(f"  {s.tab or s.state:<10} {clip(s.title, 60):<60} {s.link or ''}" for s in hits[:12])
    raise AgError(f"{ref!r} matches {len(hits)} sessions; pass a tab id, session id or link:\n{lines}")


# ---------- acting on sessions ----------

def prompt(s, text, interrupt=False):
    """Send a prompt to a session: ag-dash's /api/prompt when it has the card (marks it seen, handles
    interrupt), else ag-mux agent prompt (wakes hibernated panes)."""
    if s.state == "closed":
        raise AgError(f"{s.title} is closed; reopen it with: ag resume {s.sid[-8:]}")
    if s.card:
        try:
            return board_post("/api/prompt", {"tab": s.tab, "text": text, "interrupt": bool(interrupt)})
        except AgError as e:
            if "no such card" not in str(e) and "tab and text" not in str(e):
                raise
    if interrupt:
        mux("agent", "send-keys", s.pane, "esc", check=False)
        time.sleep(0.4)
    return mux_json("agent", "prompt", s.pane, text)


def detach(cmd):
    """Run a shell command fully detached (survives this pane closing)."""
    subprocess.Popen(["setsid", "sh", "-c", cmd], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def append_entries(path, new):
    """Append pi session entries, chained by parentId to the file's current last entry."""
    last = None
    for e in entries(path):
        if e.get("id") and e.get("type") != "session":
            last = e["id"]
    with open(path, "a", encoding="utf-8") as fh:
        for e in new:
            e.setdefault("parentId", last)
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")
            last = e["id"]


def messages(path, roles=("user", "assistant"), tools=False):
    """Transcript as [{role, text, ts}] (user/assistant text; tool calls as one-liners with tools=True)."""
    out = []
    for e in entries(path):
        t = e.get("type")
        if t == "custom_message" and e.get("display") and "user" in roles:
            out.append({"role": "note", "text": text_of(e.get("content")) or str(e.get("content", "")), "ts": e.get("timestamp")})
            continue
        if t != "message":
            continue
        m = e.get("message") or {}
        r = m.get("role")
        if r not in roles and not (tools and r == "assistant"):
            continue
        if r == "assistant":
            parts = m.get("content") if isinstance(m.get("content"), list) else []
            txt = "\n".join(c.get("text", "") for c in parts if c.get("type") == "text").strip()
            if tools:
                for c in parts:
                    if c.get("type") == "toolCall":
                        a = c.get("arguments") or {}
                        out.append({"role": "tool", "text": f"{c.get('name')}: {clip(a.get('command') or json.dumps(a, ensure_ascii=False), 200)}", "ts": e.get("timestamp")})
            if txt and r in roles:
                out.append({"role": "assistant", "text": txt, "ts": e.get("timestamp")})
        else:
            txt = text_of(m.get("content")).strip()
            if txt:
                out.append({"role": r, "text": txt, "ts": e.get("timestamp")})
    return out


def flags(argv, spec):
    """Tiny argv parser. spec: {"--name": takes_value(bool), ...}; short aliases as "-n": "--name"."""
    opts, pos, it = {}, [], iter(argv)
    aliases = {k: v for k, v in spec.items() if isinstance(v, str)}
    for a in it:
        if a == "--":
            pos += list(it)
            break
        k, _, inline = a.partition("=") if a.startswith("--") else (a, "", "")
        k = aliases.get(k, k)
        if k in spec and not isinstance(spec[k], str):
            if spec[k]:
                opts[k] = inline or next(it, None)
                if opts[k] is None:
                    raise AgError(f"{k} needs a value")
            else:
                opts[k] = True
        elif a in ("-h", "--help"):
            opts["--help"] = True
        elif a.startswith("-") and len(a) > 1 and not re.fullmatch(r"-\d+", a):
            raise AgError(f"unknown option {a}")
        else:
            pos.append(a)
    return opts, pos


def usage(doc):
    print(doc.strip())
    return 0


# ---------- machines (machines/README.md) ----------

AG_REPO = Path(os.path.realpath(__file__)).parents[4]  # bin/dot-local/lib/ag → the ag checkout


def machines():
    """Rows of the machine inventory: {alias, host, role, user, home, ag, dotfiles}.

    The private ~/ag-personal/machines.md wins when it exists; machines/README.md holds a generic example."""
    out = []
    inv = Path.home() / "ag-personal/machines.md"
    for line in (inv if inv.is_file() else AG_REPO / "machines/README.md").read_text().splitlines():
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if len(cells) >= 7 and cells[0].startswith("ag-") and cells[2] in ("host", "client", "extremity", "engine", "worker"):
            out.append(dict(zip(("alias", "host", "role", "user", "home", "ag", "dotfiles"), cells[:7])))
    return out


def this_machine():
    import socket
    h = socket.gethostname().split(".")[0]
    return next((m for m in machines() if h in (m["alias"], m["host"])), None)


def ssh(alias, script, timeout=120):
    """Run a shell script on a machine (stdin), PATH set for non-interactive SSH."""
    import base64
    pre = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"\n'
    b64 = base64.b64encode((pre + script).encode()).decode()
    # The script travels as an argument, not stdin, so nothing it runs can swallow the rest of it.
    return subprocess.run(["ssh", "-n", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=3", alias, f'sh -c "$(echo {b64} | base64 -d)"'],
                          capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)


def reachable(alias):
    try:
        return subprocess.run(["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", alias, "true"], capture_output=True, timeout=12).returncode == 0
    except subprocess.TimeoutExpired:
        return False


# ---------- services ----------

SYSTEMD_DIR = HOME / ".config/systemd/user"


def find_service(name):
    """('engine'|'mac', unit) for a service name: the session host's systemd user unit first, else ag-mac's
    LaunchAgent com.ag.<name>. 'mac:<name>' forces ag-mac."""
    if name.startswith("mac:"):
        return "mac", name[4:]
    base = re.sub(r"\.(service|timer)$", "", re.sub(r"^com\.ag\.", "", name))
    r = subprocess.run(["systemctl", "--user", "cat", f"{base}.service"], capture_output=True, text=True)
    if r.returncode == 0:
        return "engine", base
    return "mac", base


def services():
    """Ag's systemd user units on the session host (from the ag repo's systemd-user package)."""
    d = AG_REPO / "systemd-user/dot-config/systemd/user"
    return sorted({p.stem for p in d.glob("*.service")} | {p.stem for p in SYSTEMD_DIR.glob("*.service")})
