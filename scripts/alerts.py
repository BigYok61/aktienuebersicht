#!/usr/bin/env python3
"""Aktienuebersicht – Push-Alarme via ntfy (GitHub Actions, alle 15 Min. Mo–Fr).

  * Watchlist-Titel mit |Tagesveraenderung| >= 5 %: je Titel, Tag und Richtung einmal
  * beliebige US-Aktie mit |Tagesveraenderung| >= 10 % (TradingView-Screener, wie Yahoo „Day Gainers/Losers“:
    Marktkap. >= 2 Mrd. USD, Kurs >= 5 USD): je Titel und Tag einmal
  * eigene Kursalarme (data/alerts.enc.json, z. B. TSLA < 200): je Alarm und Tag einmal
  * Tageszusammenfassung um 22:15 Uhr (Europe/Zurich): Top-Bewegungen der Watchlist und Indizes
Bereits gesendete Alarme stehen verschluesselt in data/alertstate.enc.json.
Das ntfy-Topic kommt aus NTFY_TOPIC (Secret) und wird nie ausgegeben. Logs enthalten keine Ticker.
  python3 scripts/alerts.py          # regulaerer Lauf
  python3 scripts/alerts.py --test   # Test-Push "Aktienübersicht: Test"
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aucrypt  # noqa: E402

ZURICH = ZoneInfo("Europe/Zurich")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
F_WATCH = os.path.join(ROOT, "data", "watchlist.enc.json")
F_ALERTS = os.path.join(ROOT, "data", "alerts.enc.json")
F_STATE = os.path.join(ROOT, "data", "alertstate.enc.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
WATCH_PCT, US_PCT = 5.0, 10.0
APP_URL = "https://bigyok61.github.io/aktienuebersicht/"


def log(*a):
    print(*a, flush=True)


def post_json(url, obj, headers=None):
    h = {"User-Agent": UA, "Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def tv(body, market="global"):
    return json.loads(post_json(f"https://scanner.tradingview.com/{market}/scan", body)).get("data", [])


def push(topic, title, message, tags=None, priority=3):
    if os.environ.get("AU_DRY"):   # nur lokal zum Testen: nichts senden
        print("DRY:", title, "|", message.replace("\n", " / ")); return True
    obj = {"topic": topic, "title": title, "message": message, "tags": tags or [], "priority": priority, "click": APP_URL}
    for i in range(3):
        try:
            post_json("https://ntfy.sh/", obj)
            return True
        except Exception as e:  # noqa
            log(f"ntfy Fehler {type(e).__name__}")
            time.sleep(2 * (i + 1))
    return False


def fmt(v, nd=2):
    s = f"{v:,.{nd}f}".replace(",", "'")
    return s


def pct(v):
    return ("+" if v > 0 else "") + f"{v:.2f}".replace(".", ".") + " %"


def main():
    topic = (os.environ.get("NTFY_TOPIC") or "").strip()
    pw = os.environ.get("AKTIEN_PASSWORD")
    if not topic or not pw:
        log("FEHLER: NTFY_TOPIC oder AKTIEN_PASSWORD fehlt"); sys.exit(2)
    if "--test" in sys.argv:
        ok = push(topic, "Aktienübersicht: Test", "Test-Push der Aktienübersicht – die Alarme sind eingerichtet.", ["white_check_mark"])
        log("Test-Push gesendet" if ok else "Test-Push fehlgeschlagen"); sys.exit(0 if ok else 1)
    ring = aucrypt.Keyring(pw)
    watch = aucrypt.read_enc(F_WATCH, ring) or {"items": []}
    alerts = aucrypt.read_enc(F_ALERTS, ring) or {"version": 1, "alerts": []}
    state = aucrypt.read_enc(F_STATE, ring) or {"version": 1, "sent": {}}
    now_z = datetime.now(timezone.utc).astimezone(ZURICH)
    today = now_z.date().isoformat()
    force = "--force" in sys.argv
    hm = now_z.hour * 60 + now_z.minute
    if now_z.weekday() >= 5 and not force:
        log("Wochenende"); return
    in_hours = 8 * 60 <= hm <= 22 * 60 + 15 or force
    want_summary = hm >= 22 * 60 + 15 and not state.get("summary", {}).get(today)
    sent = {k: v for k, v in state.get("sent", {}).items() if k[:10] >= (now_z.date() - timedelta(days=7)).isoformat()}
    n_sent = 0
    items = [it for it in watch.get("items", []) if it.get("id")]
    name = {it["id"]: it.get("name") or it["id"].split(":")[-1] for it in items}
    sym = {it["id"]: it.get("symbol") or it["id"].split(":")[-1] for it in items}
    cols = ["close", "change", "change_abs", "currency", "type", "description", "update_time"]
    q = {}
    if items and (in_hours or want_summary):
        ids = sorted({it["id"] for it in items} | {a.get("stock") for a in alerts.get("alerts", []) if a.get("stock")})
        for i in range(0, len(ids), 100):
            for x in tv({"symbols": {"tickers": ids[i:i + 100]}, "columns": cols}):
                q[x["s"]] = dict(zip(cols, x["d"]))
    # nur Kurse von heute (Boersenzeit) zaehlen – sonst wuerde die Vortagesveraenderung gemeldet
    def fresh(d):
        t = d.get("update_time")
        if not t:
            return False
        return datetime.fromtimestamp(int(t), timezone.utc).astimezone(ZURICH).date().isoformat() == today

    if in_hours:
        # 1) Watchlist >= 5 %
        for sid, d in q.items():
            if sid not in name or d.get("type") == "index" or d.get("change") is None or not fresh(d):
                continue
            ch = d["change"]
            if abs(ch) >= WATCH_PCT:
                k = f"{today}|w|{sid}|{'up' if ch > 0 else 'down'}"
                if k not in sent:
                    if push(topic, f"{sym[sid]} {pct(ch)}", f"{name[sid]}: {fmt(d['close'])} {d.get('currency') or ''} ({pct(ch)} heute)",
                            ["chart_with_upwards_trend" if ch > 0 else "chart_with_downwards_trend"], 4):
                        sent[k] = now_z.strftime("%H:%M"); n_sent += 1
        # 2) US-Aktien >= 10 %
        try:
            base = {"columns": ["name", "description", "close", "change", "market_cap_basic", "update_time"],
                    "sort": {"sortBy": "change", "sortOrder": "desc"}, "range": [0, 50]}
            rows = []
            for op, lim, order in (("greater", US_PCT, "desc"), ("less", -US_PCT, "asc")):
                b = dict(base, sort={"sortBy": "change", "sortOrder": order},
                         filter=[{"left": "change", "operation": op, "right": lim},
                                 {"left": "market_cap_basic", "operation": "greater", "right": 2e9},
                                 {"left": "close", "operation": "greater", "right": 5},
                                 {"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
                                 {"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX"]}])
                rows += tv(b, "america")
            new = []
            for x in rows:
                dd = dict(zip(base["columns"], x["d"]))
                if not fresh(dd):
                    continue
                k = f"{today}|us|{x['s']}"
                if k not in sent:
                    new.append((k, dd))
            if new:
                new.sort(key=lambda z: -abs(z[1]["change"]))
                lines = [f"{d['name']} {pct(d['change'])} · {fmt(d['close'])} USD · {(d.get('description') or '')[:40]}" for _, d in new[:15]]
                if len(new) > 15:
                    lines.append(f"… und {len(new) - 15} weitere")
                if push(topic, f"US-Aktien ±{US_PCT:.0f} %: {len(new)} neu", "\n".join(lines), ["rotating_light"], 3):
                    for k, _ in new:
                        sent[k] = now_z.strftime("%H:%M")
                    n_sent += 1
        except Exception as e:  # noqa
            log(f"US-Screener: {type(e).__name__}")
        # 3) eigene Kursalarme
        for a in alerts.get("alerts", []):
            if not a.get("enabled", True):
                continue
            d = q.get(a.get("stock")) or {}
            px, lim, op = d.get("close"), a.get("price"), a.get("op")
            if px is None or lim is None or op not in ("<", ">") or not fresh(d):
                continue
            if (op == "<" and px < lim) or (op == ">" and px > lim):
                k = f"{today}|a|{a.get('id')}"
                if k not in sent:
                    nm = name.get(a["stock"]) or a["stock"].split(":")[-1]
                    s = sym.get(a["stock"]) or a["stock"].split(":")[-1]
                    msg = f"{nm}: {fmt(px)} {d.get('currency') or ''} ist {'unter' if op == '<' else 'über'} {fmt(lim)}" + (f"\n{a['note']}" if a.get("note") else "")
                    if push(topic, f"Kursalarm {s} {op} {fmt(lim)}", msg, ["bell"], 4):
                        sent[k] = now_z.strftime("%H:%M"); n_sent += 1
    # 4) Zusammenfassung 22:15
    if want_summary and q:
        idx = [(sid, d) for sid, d in q.items() if sid in name and d.get("type") == "index" and d.get("change") is not None]
        stk = [(sid, d) for sid, d in q.items() if sid in name and d.get("type") != "index" and d.get("change") is not None and fresh(d)]
        stk.sort(key=lambda z: z[1]["change"], reverse=True)
        L = ["Indizes: " + " · ".join(f"{name[s]} {pct(d['change'])}" for s, d in idx)] if idx else []
        if stk:
            L.append("▲ " + ", ".join(f"{sym[s]} {pct(d['change'])}" for s, d in stk[:5] if d["change"] > 0))
            L.append("▼ " + ", ".join(f"{sym[s]} {pct(d['change'])}" for s, d in stk[::-1][:5] if d["change"] < 0))
            up = sum(1 for _, d in stk if d["change"] > 0)
            L.append(f"{up} von {len(stk)} Titeln im Plus (Depot: siehe App)")
        if push(topic, f"Aktienübersicht – Tagesbilanz {now_z.strftime('%d.%m.')}", "\n".join(l for l in L if l.strip("▲▼ ")), ["bar_chart"], 3):
            state.setdefault("summary", {})[today] = now_z.strftime("%H:%M"); n_sent += 1
    state["sent"] = sent
    state["summary"] = {k: v for k, v in state.get("summary", {}).items() if k >= (now_z.date() - timedelta(days=7)).isoformat()}
    if n_sent:
        state["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        aucrypt.write_enc(F_STATE, state, ring)
    log(f"{n_sent} Push(es) gesendet; {len(q)} Kurse geprueft")


if __name__ == "__main__":
    main()
