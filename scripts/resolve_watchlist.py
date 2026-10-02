#!/usr/bin/env python3
"""Einmalig/bei Bedarf: Yahoo-Ticker -> TradingView-ID + CNBC-Symbol pruefen. Gibt KEINE Liste aus, wenn --quiet."""
import json, sys, urllib.parse, urllib.request
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
IDX = {"^DJI": ("DJ:DJI", ".DJI", "Dow Jones"), "^GSPC": ("SP:SPX", ".SPX", "S&P 500"), "^NDX": ("NASDAQ:NDX", ".NDX", "Nasdaq 100"),
       "^GDAXI": ("XETR:DAX", ".GDAXI", "DAX"), "^FTSE": ("FTSE:UKX", ".FTSE", "FTSE 100"), "^SSMI": ("SIX:SMI", ".SSMI", "SMI")}
SUF = {".SW": ("SIX", "-CH"), ".DE": ("XETR", "-DE"), ".L": ("LSE", "-GB")}

def get(url, data=None, h=None):
    hh = {"User-Agent": UA}; hh.update(h or {})
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hh), timeout=30).read())

def tv(tickers):
    cols = ["description", "type", "exchange", "currency", "close"]
    d = get("https://scanner.tradingview.com/global/scan", json.dumps({"symbols": {"tickers": tickers}, "columns": cols}).encode(), {"Content-Type": "application/json"})
    return {x["s"]: dict(zip(cols, x["d"])) for x in d.get("data", [])}

def cnbc(syms):
    out = {}
    for i in range(0, len(syms), 20):
        url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" + urllib.parse.quote("|".join(syms[i:i+20]), safe="|")
               + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json")
        for x in get(url)["FormattedQuoteResult"]["FormattedQuote"]:
            out[x.get("symbol")] = x
    return out

def candidates(y):
    if y in IDX:
        return [IDX[y][0]], IDX[y][1]
    for s, (ex, cs) in SUF.items():
        if y.endswith(s):
            t = y[: -len(s)]
            return [f"{ex}:{t}"], t + cs
    t = y.replace("-", ".")
    return [f"{e}:{t}" for e in ("NASDAQ", "NYSE", "AMEX", "OTC")], t

def resolve(entries):
    """entries: [(yahoo, category)] -> (items, failed)"""
    cands, cn = {}, {}
    for y, _ in entries:
        cands[y], cn[y] = candidates(y)
    allc = sorted({c for v in cands.values() for c in v})
    t = {}
    for i in range(0, len(allc), 50):
        t.update(tv(allc[i:i+50]))
    q = cnbc(sorted(set(cn.values())))
    items, failed = [], []
    for y, cat in entries:
        hit = next((c for c in cands[y] if c in t), None)
        cq = q.get(cn[y]) or {}
        okc = cq.get("code") == 0
        if not hit and not okc:
            failed.append((y, "weder TradingView noch CNBC")); continue
        name = IDX[y][2] if y in IDX else (t.get(hit, {}).get("description") or cq.get("name") or y)
        it = {"id": hit or ("CNBC:" + cn[y]), "symbol": y, "name": name, "category": cat}
        if okc: it["cnbc"] = cn[y]
        else: failed.append((y, "nur TradingView (keine Zeitpunkt-Kurse von CNBC)"))
        if not hit: failed.append((y, "nur CNBC (kein Jetzt-Kurs/Kursziel von TradingView)"))
        items.append(it)
    return items, failed

if __name__ == "__main__":
    ents = [tuple(l.split("\t")) for l in sys.stdin.read().splitlines() if l.strip()]
    items, failed = resolve(ents)
    print(json.dumps({"items": items, "failed": failed}, ensure_ascii=False, indent=1))
