#!/usr/bin/env python3
"""OVHcloud US bare metal: configs with >= MIN_RAM GB RAM that are in stock in US DCs (vin/hil),
with no-commitment monthly price, setup fee, CPU, disks, bandwidth. Public API, no auth needed.
usage: inventory.py [MIN_RAM_GB=256] [MAX_MONTHLY_USD=1500]"""
import json, re, sys, urllib.request
MIN_RAM = int(sys.argv[1]) if len(sys.argv) > 1 else 256
MAX = float(sys.argv[2]) if len(sys.argv) > 2 else 1500
BASE = "https://api.us.ovhcloud.com/1.0"
get = lambda p: json.load(urllib.request.urlopen(BASE + p))
cat = {k: [] for k in ("plans","addons","products")}
for c in ("baremetalServers", "eco"):
    d = get(f"/order/catalog/public/{c}?ovhSubsidiary=US")
    for k in cat: cat[k] += d[k]
avail = get("/dedicated/server/datacenter/availabilities")
plans = {p["planCode"]: p for p in cat["plans"]}
addons = {a["planCode"]: a for a in cat["addons"]}
products = {p["name"]: p for p in cat["products"]}
def price(item, cap="renew"):
    for p in item["pricings"]:
        if cap in p["capacities"] and p["mode"] == "default" and p["commitment"] == 0 and (cap != "renew" or p["interval"] == 1):
            return p["price"] / 1e8
    return 0.0
def fam(plan, name): return next((f for f in plan.get("addonFamilies", []) if f["name"] == name), None)
def match(plan, name, code):
    f = fam(plan, name)
    if not f: return None
    c = [a for a in f["addons"] if a == code or a.startswith(code + "-")]
    return min(c, key=len) if c else None
rows = []
for a in avail:
    m = re.match(r"ram-(\d+)g", a["memory"] or "")
    if not m or int(m.group(1)) < MIN_RAM or a["storage"] in ("noraid-0", None): continue
    dcs = {d["datacenter"]: d["availability"] for d in a["datacenters"] if d["datacenter"] in ("vin", "hil") and d["availability"] not in ("unavailable", "unknown")}
    if not dcs or a["planCode"] not in plans: continue
    plan = plans[a["planCode"]]
    mem, sto = match(plan, "memory", a["memory"]), match(plan, "storage", a["storage"])
    if not mem or not sto: continue
    bwf = fam(plan, "bandwidth"); bws = bwf["addons"] if bwf else []
    bw_def = bwf.get("default") if bwf else None
    cpu = products.get(plan["product"], {}).get("blobs", {}).get("technical", {}).get("server", {}).get("cpu", {})
    monthly = price(plan) + sum(price(addons[x]) for x in (mem, sto, bw_def) if x)
    setup = price(plan, "installation") + sum(price(addons[x], "installation") for x in (mem, sto, bw_def) if x)
    bw_up = {b: round(price(addons[b]), 2) for b in bws}
    rows.append(dict(plan=a["planCode"], fqn=a["fqn"], name=plan["invoiceName"], cpu=f'{cpu.get("brand","")} {cpu.get("model","")}'.strip(),
        cores=cpu.get("cores"), threads=cpu.get("threads"), ghz=f'{cpu.get("frequency")}/{cpu.get("boost")}', score=cpu.get("score"),
        memory=mem, storage=sto, bandwidth_default=bw_def, bandwidth_options=bw_up, monthly=round(monthly, 2), setup=round(setup, 2), dcs=dcs))
rows.sort(key=lambda r: r["monthly"])
json.dump(rows, open("/tmp/ovh-inventory.json", "w"), indent=1)
for r in rows:
    if r["monthly"] > MAX: continue
    print(f'${r["monthly"]:>8.2f}/mo setup ${r["setup"]:>7.2f} | {r["name"][:26]:<26} {r["cpu"][:22]:<22} {r["cores"]}c/{r["threads"]}t {r["ghz"]} sc={r["score"]} | {r["memory"]} | {r["storage"]} | {r["dcs"]} | bw={r["bandwidth_default"]}')
