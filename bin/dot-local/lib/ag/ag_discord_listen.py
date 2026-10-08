"""ag discord listen: answer the thanks!/bro... buttons on the ag bot's Discord posts.

Run through `ag discord listen` (ag-discord.service on the session host), which starts this under
uv with `websockets`. It holds a Discord gateway connection (no privileged intents: interactions
arrive without any), acknowledges each press within Discord's 3 s window, then:
  thanks!  logs it.
  bro...   wakes the posting session (`ag send`, `ag resume` first if it's closed, else the ag-inbox)
           saying the reply missed, and texts the user (`ag-text`). Once per person per message.
"""
import asyncio, json, os, subprocess, sys, time
from importlib.machinery import SourceFileLoader
from pathlib import Path

import websockets

d = SourceFileLoader("ag_discord", str(Path(__file__).resolve().parents[2] / "bin/ag-discord")).load_module()
BIN, LOG = d.BIN, d.FEEDBACK


def log(**e):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(json.dumps({"at": int(time.time()), **e}, ensure_ascii=False) + "\n")


def already(kind, msg, user):
    try:
        return any((e.get("kind"), e.get("message"), e.get("user_id")) == (kind, msg, user)
                   for e in map(json.loads, LOG.read_text().splitlines()))
    except (OSError, ValueError):
        return False


def run(*cmd, **kw):
    try:
        r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=180, **kw)
        return r.returncode == 0, (r.stderr or r.stdout).strip()[-300:]
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def wake(sid, prompt):
    if sid:
        ok, out = run(BIN / "ag", "send", sid, prompt)
        if ok:
            return "send"
        if run(BIN / "ag", "resume", sid)[0]:
            time.sleep(8)
            if run(BIN / "ag", "send", sid, prompt)[0]:
                return "resume+send"
    ok, out = run("curl", "-fsS", "-m", "120", "--data-binary", "@-", "http://ag:7373/prompt", input=prompt)
    return "inbox" if ok else f"failed: {out}"


def on_bro(i, sid, who, url, content):
    snippet = " ".join(content.split())[:400]
    tag = d.re.sub(r'["<>&]', "", who)
    prompt = (f'<ag-origin kind="discord" label="Discord: bro..." title="{tag}">'
              f"{who} pressed \"bro...\" on a Discord message this session posted.</ag-origin>"
              f'{who} pressed the "bro..." button on your Discord message, meaning your response wasn\'t helpful '
              f"in some way.\n\n{url}\n\n> {snippet}\n\n"
              f"Work out what missed (read the thread around it with `ag discord read`, and anything newer), "
              f"then follow up in Discord with a better answer, or ask what was missing if you can't tell.")
    via = wake(sid, prompt)
    env = {**os.environ, "AG_TEXT_SESSION": sid}
    run(BIN / "ag-text", f'🤦 "bro..." from {who} on Discord\n{url}\n{snippet[:160]}', env=env)
    log(kind="bro-handled", message=i["message"]["id"], user_id=i["_uid"], session=sid, via=via)


async def handle(i):
    data = i.get("data") or {}
    parts = (data.get("custom_id") or "").split(":")
    if i.get("type") != 3 or parts[:2] != ["ag", "fb"] or len(parts) < 3:
        return
    kind, sid = parts[2], (parts[3] if len(parts) > 3 else "")
    user = (i.get("member") or {}).get("user") or i.get("user") or {}
    who, uid = user.get("global_name") or user.get("username") or "someone", user.get("id")
    msg = i.get("message") or {}
    i["_uid"] = uid
    url = d.link(msg.get("channel_id") or i.get("channel_id"), msg.get("id"))
    repeat = already(kind, msg.get("id"), uid)
    reply = {"thanks": "🙏 Thanks! Glad it helped.",
             "bro": "😬 Sorry about that. I've flagged it so it gets a better follow-up."}.get(kind, "Noted.")
    if kind == "bro" and repeat:
        reply = "Already flagged, thanks. A follow-up is on the way."
    await asyncio.to_thread(d.api, "POST", f"/interactions/{i['id']}/{i['token']}/callback",
                            {"type": 4, "data": {"content": reply, "flags": 64}})
    log(kind=kind, message=msg.get("id"), channel=msg.get("channel_id"), user_id=uid, user=who, session=sid,
        repeat=repeat)
    if kind == "bro" and not repeat:
        await asyncio.to_thread(on_bro, i, sid, who, url, msg.get("content") or "")


async def session():
    url = d.api("GET", "/gateway/bot")["url"] + "/?v=10&encoding=json"
    async with websockets.connect(url, max_size=2**23) as ws:
        hello = json.loads(await ws.recv())
        seq = None

        async def beat():
            while True:
                await ws.send(json.dumps({"op": 1, "d": seq}))
                await asyncio.sleep(hello["d"]["heartbeat_interval"] / 1000)

        hb = asyncio.create_task(beat())
        await ws.send(json.dumps({"op": 2, "d": {"token": d.token(), "intents": 0,
                                                 "properties": {"os": "linux", "browser": "ag", "device": "ag"}}}))
        try:
            async for raw in ws:
                ev = json.loads(raw)
                seq = ev.get("s") or seq
                if ev["op"] == 1:
                    await ws.send(json.dumps({"op": 1, "d": seq}))
                elif ev["op"] in (7, 9):
                    return  # reconnect / invalid session: start over
                elif ev.get("t") == "READY":
                    print(f"ag discord listen: connected as {ev['d']['user']['username']}", flush=True)
                elif ev.get("t") == "INTERACTION_CREATE":
                    asyncio.create_task(guard(ev["d"]))
        finally:
            hb.cancel()


async def guard(i):
    try:
        await handle(i)
    except BaseException as e:  # d.api() exits on HTTP errors; keep the connection alive
        log(kind="error", error=repr(e)[:300], custom_id=(i.get("data") or {}).get("custom_id"))


async def main():
    while True:
        try:
            await session()
        except Exception as e:
            print(f"ag discord listen: {e!r}; reconnecting", file=sys.stderr, flush=True)
        await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
