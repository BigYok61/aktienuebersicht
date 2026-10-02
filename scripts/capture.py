#!/usr/bin/env python3
"""Aktienuebersicht – serverseitige Erfassung (GitHub Actions, ohne API-Schluessel).

Quellen (getestet von GitHub-Runnern und vom Entwicklungsrechner, Stand Okt. 2026):
  * CNBC  ts-api.cnbc.com  – 5-Minuten-Kerzen ~10 Handelstage (Werte zu den Zeitpunkten, Nachtrag),
                             Tageskerzen ~2 Jahre (Schlusskurse, Prognosemodelle), Devisen (CHF=, EURCHF= …)
  * CNBC  quote.cnbc.com   – Stammdaten, Jahresdividende/Rendite in Handelswaehrung, letzter Ex-Tag (US/DE)
  * TradingView scanner    – Branche, Dividendentermine (Ex-/Zahltag), Analysten-Kursziel (Konsens)
  * Google News RSS        – Schlagzeilen der letzten 72 Stunden
  (Yahoo Finance antwortet von GitHub-Runnern mit HTTP 429, Stooq verlangt JavaScript – beide unbrauchbar.)

Alle Datendateien unter data/ sind mit AES-256-GCM verschluesselt (scripts/aucrypt.py),
Passwort aus der Umgebungsvariablen AKTIEN_PASSWORD (GitHub-Secret).
Idempotent: Werte zu Zeitpunkten, Schlusskurse und Prognosen werden nie ueberschrieben.
"""
import calendar, json, math, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone, date
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aucrypt  # noqa: E402

ZURICH = ZoneInfo("Europe/Zurich")
SLOT_HOURS = [9, 12, 15, 18, 22]
SLOT_DELAY = timedelta(minutes=20)   # Kurse sind bis 15 Min. verzoegert -> Zeitpunkt erst danach festhalten
START_DAY = date(2026, 10, 2)
NEWS_HOURS = 72
NEWS_PER_STOCK = 5
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
F_WATCH = os.path.join(ROOT, "data", "watchlist.enc.json")
F_QUOTES = os.path.join(ROOT, "data", "quotes.enc.json")
F_NEWS = os.path.join(ROOT, "data", "news.enc.json")

DEFAULT_CATEGORIES = ["Indizes", "Tech", "Auto", "Pharma", "Banken", "Konsum", "Industrie"]
# TradingView-Boerse -> CNBC-Suffix
EXCHANGE_SUFFIX = {"SIX": "-CH", "BX": "-CH", "XETR": "-DE", "FWB": "-DE", "NASDAQ": "", "NYSE": "", "AMEX": "",
                   "NYSE ARCA": "", "CBOE": "", "OTC": "", "LSE": "-GB", "MIL": "-IT", "BME": "-ES", "TSX": "-CA",
                   "VIE": "-AT", "OMXSTO": "-SE", "OMXCOP": "-DK", "OSL": "-NO", "OMXHEX": "-FI", "TSE": "-JP",
                   "HKEX": "-HK", "ASX": "-AU", "EURONEXT": "-FR"}
INDEX_MAP = {"SIX:SMI": ".SSMI", "SP:SPX": ".SPX", "TVC:DJI": ".DJI", "DJ:DJI": ".DJI", "NASDAQ:NDX": ".NDX",
             "XETR:DAX": ".GDAXI", "TVC:DEU40": ".GDAXI", "TVC:SX5E": ".STOXX50E", "SIX:SLI": ".SLI", "SIX:SPI": ".SSHI",
             "TVC:NI225": ".N225", "TVC:UKX": ".FTSE", "FTSE:UKX": ".FTSE", "NASDAQ:IXIC": ".IXIC"}


def log(*a):
    print(*a, flush=True)


def tag(sid):
    """Kennung fuer oeffentliche Logs (Actions-Logs sind bei oeffentlichen Repos sichtbar) – nie den Ticker ausgeben."""
    import hashlib
    return "#" + hashlib.sha256(("au:" + str(sid)).encode()).hexdigest()[:6]


def http(url, data=None, headers=None, timeout=30, tries=2):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def get_json(url, **kw):
    return json.loads(http(url, **kw).decode("utf-8"))


# ---------------------------------------------------------------- Kategorien (identisch in app.js / Swift)

def category_for(sector, industry, typ):
    s, i = (sector or "").lower(), (industry or "").lower()
    if typ == "index":
        return "Indizes"
    if "motor vehicle" in i or "auto" in i:
        return "Auto"
    if s in ("electronic technology", "technology services"):
        return "Tech"
    if s in ("health technology", "health services"):
        return "Pharma"
    if s == "finance":
        return "Banken"
    if s in ("consumer non-durables", "consumer durables", "retail trade", "consumer services"):
        return "Konsum"
    if s in ("producer manufacturing", "industrial services", "process industries", "non-energy minerals",
             "transportation", "commercial services"):
        return "Industrie"
    if s in ("energy minerals", "utilities"):
        return "Energie"
    if s == "communications":
        return "Telekom"
    return "Sonstige"


# ---------------------------------------------------------------- Datumshilfen

def slot_dt(d, hour):
    return datetime(d.year, d.month, d.day, hour, tzinfo=ZURICH)


def is_weekday(d):
    return d.weekday() < 5


def weekdays(frm, to):
    out, d = [], frm
    while d <= to:
        if is_weekday(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def add_months(d, n):
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def targets_for(d):
    return {"1d": d.isoformat(), "7d": (d + timedelta(days=7)).isoformat(),
            "3m": add_months(d, 3).isoformat(), "12m": add_months(d, 12).isoformat()}


# ---------------------------------------------------------------- Quellen

def cnbc_bars(symbol, rng):
    d = get_json(f"https://ts-api.cnbc.com/harmony/app/charts/{rng}.json?symbol={urllib.parse.quote(symbol)}")
    bars = (d.get("barData") or {}).get("priceBars") or []
    out = []
    for b in bars:
        try:
            out.append((b["tradeTimeinMills"] / 1000.0, float(b["open"]), float(b["high"]), float(b["low"]),
                        float(b["close"]), b["tradeTime"][:8]))
        except (KeyError, ValueError, TypeError):
            continue
    out.sort()
    return out


def cnbc_quotes(symbols):
    out = {}
    for i in range(0, len(symbols), 20):
        part = "|".join(symbols[i:i + 20])
        url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols="
               + urllib.parse.quote(part, safe="|") + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1")
        q = get_json(url)["FormattedQuoteResult"]["FormattedQuote"]
        for x in q:
            out[x.get("symbol")] = x
    return out


def cnbc_lookup(name, country=None):
    url = ("https://symlookup.cnbc.com/symservice/symlookup.do?prefix=" + urllib.parse.quote(name)
           + "&partnerid=20064&pgok=1&pgsize=10")
    res = get_json(url)[1:]
    for r in res:
        if country is None or r.get("countryCode") == country:
            return r.get("symbolName")
    return None


TV_COLS = ["name", "description", "close", "currency", "type", "exchange", "sector", "industry", "update_time",
           "fundamental_currency_code", "dividends_yield_current", "dps_common_stock_prim_issue_fy",
           "dividend_ex_date_upcoming", "dividend_payment_date_upcoming", "dividend_amount_upcoming",
           "dividend_ex_date_recent", "dividend_payment_date_recent", "dividend_amount_recent",
           "price_target_1y", "price_target_average", "price_target_median", "price_target_high", "price_target_low",
           "recommendation_total", "country"]


def tv_scan(tickers):
    body = json.dumps({"symbols": {"tickers": tickers}, "columns": TV_COLS}).encode()
    d = get_json("https://scanner.tradingview.com/global/scan", data=body, headers={"Content-Type": "application/json"})
    return {x["s"]: dict(zip(TV_COLS, x["d"])) for x in d.get("data", [])}


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def mdy(s):
    try:
        return datetime.strptime(s, "%m/%d/%Y").date()
    except (TypeError, ValueError):
        return None


def tsdate(t):
    """TradingView-Zeitstempel (Sekunden, Tagesende-Konvention UTC) -> Datum."""
    if not t:
        return None
    return datetime.fromtimestamp(int(t), timezone.utc).date()


# ---------------------------------------------------------------- Prognosemodelle (identisch dokumentiert in README)

def _clamp(x, lim):
    return min(max(x, -lim), lim)


def fc_day_end(spot, daily):
    """Prognose Tagesende. daily: [(datum, open, high, low, close)] vor dem Tag, aelteste zuerst."""
    if len(daily) < 2:
        return None
    closes = [c[4] for c in daily[-6:]][::-1]  # neuester zuerst
    trend = (closes[0] - closes[-1]) / (len(closes) - 1)
    overnight = spot - closes[0]
    ranges = [c[2] - c[3] for c in daily[-5:] if c[2] >= c[3]]
    avg = sum(ranges) / len(ranges) if ranges else abs(spot) * 0.01
    return spot + _clamp(0.5 * trend - 0.3 * overnight, 0.5 * avg)


def _rets(closes):
    return [math.log(closes[i + 1] / closes[i]) for i in range(len(closes) - 1) if closes[i] > 0 and closes[i + 1] > 0]


def _sd(r):
    if len(r) < 3:
        return 0.01
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1))


def fc_horizon(spot, daily, h, look, need, damp, revert_w, sma_n):
    closes = [c[4] for c in daily[-look:]]
    if len(closes) < need or spot <= 0:
        return None
    r = _rets(closes)
    if not r:
        return None
    m = sum(r) / len(r)
    sma = sum(closes[-sma_n:]) / len(closes[-sma_n:])
    drift = damp * m * h
    revert = revert_w * math.log(sma / spot) if sma > 0 else 0.0
    lim = _sd(r) * math.sqrt(h)
    return spot * math.exp(_clamp(drift + revert, lim))


def fc_7d(spot, daily):   # 5 Handelstage, Momentum der letzten 10 Tage (gedaempft 0.3), Rueckkehr zum 20-Tage-Mittel
    return fc_horizon(spot, daily, 5, 11, 3, 0.3, 0.15, 20)


def fc_3m(spot, daily):   # 63 Handelstage, Drift der letzten 250 Tage (gedaempft 0.5), Rueckkehr zum 200-Tage-Mittel
    return fc_horizon(spot, daily, 63, 251, 60, 0.5, 0.10, 200)


def fc_12m(spot, daily):  # 252 Handelstage, Drift der letzten 500 Tage (gedaempft 0.5), Rueckkehr zum 200-Tage-Mittel
    return fc_horizon(spot, daily, 252, 501, 200, 0.5, 0.10, 200)


# ---------------------------------------------------------------- Hilfen Datenstand

def put(dct, key, val, nd=6):
    if key in dct or val is None or not math.isfinite(val):
        return 0
    dct[key] = round(val, nd)
    return 1


def day_rec(q, key):
    r = q["days"].setdefault(key, {})
    r.setdefault("slots", {})
    r.setdefault("fx", {})
    r.setdefault("close", {})
    r.setdefault("fc", {})
    r.setdefault("targets", targets_for(date.fromisoformat(key)))
    return r


def value_at(bars, t_epoch, max_age=4 * 86400):
    """Letzter Kurs zum Zeitpunkt: Schlusskurs der letzten 5-Min.-Kerze, die vor t begonnen hat."""
    best = None
    for b in bars:
        if b[0] < t_epoch:
            best = b
        else:
            break
    if best is None or t_epoch - best[0] > max_age:
        return None
    return best[4]


def fx_symbol(ccy):
    return "CHF=" if ccy == "USD" else f"{ccy}CHF="


def norm_ccy(ccy):
    """GBX/GBp (Pence) -> (GBP, 0.01)"""
    if ccy in ("GBX", "GBp"):
        return "GBP", 0.01
    if ccy == "ILA":
        return "ILS", 0.01
    if ccy == "ZAC":
        return "ZAR", 0.01
    return ccy, 1.0


# ---------------------------------------------------------------- Hauptablauf

def main():
    pw = os.environ.get("AKTIEN_PASSWORD")
    if not pw:
        log("FEHLER: AKTIEN_PASSWORD fehlt")
        sys.exit(2)
    ring = aucrypt.Keyring(pw)
    now = datetime.now(timezone.utc)
    now_z = now.astimezone(ZURICH)
    today = now_z.date()
    errors = []

    watch = aucrypt.read_enc(F_WATCH, ring)
    if watch is None:   # keine Startliste im Code (die Watchlist liegt nur verschluesselt im Repo)
        watch = {"version": 2, "categories": DEFAULT_CATEGORIES, "items": []}
        aucrypt.write_enc(F_WATCH, watch, ring)
        log("Leere Watchlist angelegt")
    quotes = aucrypt.read_enc(F_QUOTES, ring) or {"version": 1, "days": {}, "symbols": {}}
    quotes.setdefault("days", {})
    quotes.setdefault("symbols", {})
    quotes.setdefault("dividends", {})
    quotes.setdefault("targets", {})
    items = [it for it in watch.get("items", []) if it.get("id")]
    ids = [it["id"] for it in items]
    changed = 0

    # --- TradingView: Stammdaten, Branche, Dividendentermine, Kursziele, aktueller Kurs
    tv = {}
    try:
        tv = tv_scan(ids)
    except Exception as e:  # noqa
        errors.append(f"TradingView: {e}")

    # --- CNBC-Symbole aufloesen
    for it in items:
        sid = it["id"]
        meta = quotes["symbols"].setdefault(sid, {})
        if it.get("cnbc"):
            meta["cnbc"] = it["cnbc"]
        if not meta.get("cnbc"):
            if sid in INDEX_MAP:
                meta["cnbc"] = INDEX_MAP[sid]
            elif ":" in sid:
                ex, tk = sid.split(":", 1)
                if ex in EXCHANGE_SUFFIX:
                    meta["cnbc"] = tk + EXCHANGE_SUFFIX[ex]
    cq = {}
    try:
        cq = cnbc_quotes(sorted({m["cnbc"] for m in quotes["symbols"].values() if m.get("cnbc")}))
    except Exception as e:  # noqa
        errors.append(f"CNBC Quote: {e}")
    for it in items:   # nicht gefundene Symbole per Namenssuche nachschlagen
        sid, meta = it["id"], quotes["symbols"][it["id"]]
        x = cq.get(meta.get("cnbc"))
        if cq and (x is None or x.get("code") != 0) and not meta.get("lookupTried") and not it.get("cnbc"):
            meta["lookupTried"] = True
            t = tv.get(sid) or {}
            try:
                country = {"-CH": "CH", "-DE": "DE", "": "US"}.get(EXCHANGE_SUFFIX.get(sid.split(":")[0], "?"))
                alt = cnbc_lookup(t.get("description") or it.get("name") or sid.split(":")[-1], country)
                if alt:
                    meta["cnbc"] = alt
                    cq.update(cnbc_quotes([alt]))
            except Exception as e:  # noqa
                errors.append(f"CNBC Suche {tag(sid)}: {type(e).__name__}")

    for it in items:
        sid, meta = it["id"], quotes["symbols"][it["id"]]
        t, x = tv.get(sid) or {}, cq.get(meta.get("cnbc")) or {}
        ok_c, ok_t = x.get("code") == 0, bool(t)
        meta["status"] = "ok" if (ok_c or ok_t) else ("unbekannt" if (cq or tv) else meta.get("status", "neu"))
        meta["name"] = it.get("name") or t.get("description") or x.get("name") or sid
        meta["longName"] = t.get("description") or x.get("name") or meta.get("longName")
        meta["currency"] = t.get("currency") or x.get("currencyCode") or meta.get("currency")
        typ = (t.get("type") or (x.get("type") or "").lower() or meta.get("type") or "stock")
        meta["type"] = "index" if typ == "index" else typ
        if meta["type"] == "index" and not meta.get("currency"):
            meta["currency"] = x.get("currencyCode")
        meta["exchange"] = t.get("exchange") or x.get("exchange") or meta.get("exchange")
        meta["sector"] = t.get("sector") or meta.get("sector")
        meta["industry"] = t.get("industry") or meta.get("industry")
        meta["suggestedCategory"] = category_for(meta.get("sector"), meta.get("industry"), meta["type"])
        if t.get("close") is not None:
            meta["last"] = t["close"]
            meta["lastTime"] = datetime.fromtimestamp(int(t.get("update_time") or now.timestamp()), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        elif num(x.get("last")) is not None:
            meta["last"] = num(x.get("last"))
            meta["lastTime"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- Devisen (CHF je Einheit) an den Zeitpunkten
    ccys = sorted({norm_ccy(m.get("currency") or "CHF")[0] for m in quotes["symbols"].values() if m.get("currency")} - {"CHF"})
    days = weekdays(START_DAY, today)
    for ccy in ccys:
        try:
            bars = cnbc_bars(fx_symbol(ccy), "5D")
        except Exception as e:  # noqa
            errors.append(f"FX: {type(e).__name__}")
            continue
        for d in days:
            for hh in SLOT_HOURS:
                t = slot_dt(d, hh)
                if now < t + SLOT_DELAY:
                    continue
                v = value_at(bars, t.timestamp(), max_age=3 * 3600)
                if v is not None:
                    changed += put(day_rec(quotes, d.isoformat())["fx"].setdefault(f"{hh:02d}", {}), ccy, v)

    # --- Kurse: Zeitpunkte, Schlusskurse, Prognosen
    for it in items:
        sid, meta = it["id"], quotes["symbols"][it["id"]]
        sym = meta.get("cnbc")
        if not sym or (cq and (cq.get(sym) or {}).get("code") != 0):
            continue
        try:
            intraday = cnbc_bars(sym, "5D")
            daily_raw = cnbc_bars(sym, "3M")   # bei CNBC: ca. 2 Jahre Tageskerzen
        except Exception as e:  # noqa
            errors.append(f"{tag(sid)}: {type(e).__name__}")
            continue
        daily = []
        for b in daily_raw:
            ds = b[5]
            try:
                daily.append((date(int(ds[:4]), int(ds[4:6]), int(ds[6:8])), b[1], b[2], b[3], b[4]))
            except ValueError:
                pass
        daily.sort()
        added = date.fromisoformat(it.get("added") or START_DAY.isoformat())
        for d in days:
            key = d.isoformat()
            for hh in SLOT_HOURS:
                t = slot_dt(d, hh)
                if now < t + SLOT_DELAY:
                    continue
                v = value_at(intraday, t.timestamp())
                if v is not None:
                    changed += put(day_rec(quotes, key)["slots"].setdefault(f"{hh:02d}", {}), sid, v)
        for (dd, o, hi, lo, c) in daily:
            if START_DAY <= dd < today and is_weekday(dd):
                changed += put(day_rec(quotes, dd.isoformat())["close"], sid, c)
        # Prognosen einmal je Handelstag zum ersten Zeitpunkt (09:00): nur Daten vor diesem Tag + Kurs 09:00
        for d in days:
            key = d.isoformat()
            rec = quotes["days"].get(key)
            spot = ((rec or {}).get("slots", {}).get(f"{SLOT_HOURS[0]:02d}") or {}).get(sid)
            if spot is None:
                continue
            hist = [x for x in daily if x[0] < d]
            # Tageskerze von heute darf nicht einfliessen; Feiertage: kein Handel -> keine Prognose
            if hist and (d - hist[-1][0]).days > 5:
                continue
            fc = rec["fc"]
            for k, fn in (("1d", fc_day_end), ("7d", fc_7d), ("3m", fc_3m), ("12m", fc_12m)):
                changed += put(fc.setdefault(k, {}), sid, fn(spot, hist))
        meta["history"] = len(daily)
        meta["added"] = added.isoformat()

        # --- Dividende (Betrag/Rendite in Handelswaehrung bevorzugt von CNBC; Termine von TradingView)
        t, x = tv.get(sid) or {}, cq.get(sym) or {}
        ev = x.get("EventData") or {}
        dv = {"asOf": today.isoformat()}
        price = num(meta.get("last")) or num(x.get("last"))
        fx_fund = 1.0
        fund_ccy = t.get("fundamental_currency_code")
        if fund_ccy and meta.get("currency") and fund_ccy != meta["currency"] and t.get("price_target_average") and t.get("price_target_1y"):
            fx_fund = t["price_target_1y"] / t["price_target_average"]   # TradingView liefert Fundamentaldaten teils in USD
        if meta["type"] == "index":
            dv["status"] = "index"
        else:
            annual = num(x.get("dividend"))
            yld = num(x.get("dividendyield"))
            tv_yield = t.get("dividends_yield_current")
            if annual and annual > 0:
                dv.update(status="ok", annual=annual, yield_=yld if yld is not None else (annual / price * 100 if price else None), source="CNBC")
            elif tv_yield and tv_yield > 0 and price:
                dv.update(status="ok", annual=round(tv_yield / 100 * price, 4), yield_=tv_yield, source="TradingView (berechnet)")
            elif (tv_yield == 0 or t.get("dps_common_stock_prim_issue_fy") == 0) and (x.get("pe") or x.get("mktcapView") or t):
                dv["status"] = "none"
            else:
                dv["status"] = "unknown"
            if dv.get("status") == "ok":
                if "yield_" in dv:
                    dv["yield"] = dv.pop("yield_")
                last_ex = tsdate(t.get("dividend_ex_date_recent")) or mdy(ev.get("div_ex_date"))
                last_pay = tsdate(t.get("dividend_payment_date_recent"))
                cnbc_amt = num(ev.get("div_amount"))
                same_ccy = not fund_ccy or fund_ccy == meta.get("currency")
                freq = None
                dps, amt_r = t.get("dps_common_stock_prim_issue_fy"), t.get("dividend_amount_recent")
                if cnbc_amt and dv.get("annual"):
                    freq = dv["annual"] / cnbc_amt          # gleiche Waehrung (CNBC)
                elif dps and amt_r:
                    freq = dps / amt_r                       # Verhaeltnis, waehrungsunabhaengig
                if freq:
                    freq = min((1, 2, 4, 12), key=lambda f: abs(f - freq))
                    dv["frequency"] = freq
                last_amt = cnbc_amt
                if last_amt is None and amt_r and same_ccy:
                    last_amt = amt_r
                if last_amt is None and freq and dv.get("annual"):
                    last_amt = dv["annual"] / freq
                    dv["lastAmountEstimated"] = True
                dv.update(lastEx=last_ex and last_ex.isoformat(), lastPay=last_pay and last_pay.isoformat(),
                          lastAmount=last_amt and round(last_amt, 4))
                nx = tsdate(t.get("dividend_ex_date_upcoming"))
                npay = tsdate(t.get("dividend_payment_date_upcoming"))
                me = mdy(ev.get("div_ex_date"))
                if nx is None and me and me >= today:
                    nx = me
                if nx and nx >= today:
                    dv.update(nextEx=nx.isoformat(), nextPay=npay and npay.isoformat(), nextEstimated=False)
                    if t.get("dividend_amount_upcoming") and same_ccy:
                        dv["nextAmount"] = round(t["dividend_amount_upcoming"], 4)
                elif last_ex and freq:
                    step = 12 // freq
                    ex, pay, n = last_ex, last_pay, 0
                    while ex < today and n < 40:
                        ex, n = add_months(ex, step), n + 1
                        pay = add_months(pay, step) if pay else None
                    dv.update(nextEx=ex.isoformat(), nextPay=pay and pay.isoformat(), nextEstimated=True)
                dv["source"] = dv.get("source", "") + (" + TradingView (Termine)" if t else "")
        quotes["dividends"][sid] = dv

        # --- Analysten-Kursziel (Konsens 12 Monate, TradingView/FactSet)
        if meta["type"] != "index" and t.get("price_target_1y"):
            f = fx_fund
            quotes["targets"][sid] = {
                "mean": round(t["price_target_1y"], 4),
                "median": t.get("price_target_median") and round(t["price_target_median"] * f, 4),
                "high": t.get("price_target_high") and round(t["price_target_high"] * f, 4),
                "low": t.get("price_target_low") and round(t["price_target_low"] * f, 4),
                "count": t.get("recommendation_total"),
                "currency": meta.get("currency"), "source": "TradingView (Konsens, Daten von FactSet)",
                "asOf": today.isoformat()}
        else:
            quotes["targets"][sid] = {"status": "keine Daten" if meta["type"] != "index" else "index", "asOf": today.isoformat()}

    # entfernte Titel bleiben im Verlauf, Stammdaten werden aber nicht mehr aktualisiert
    quotes["days"] = dict(sorted(quotes["days"].items()))
    quotes["slotHours"] = SLOT_HOURS
    quotes["startDay"] = START_DAY.isoformat()
    quotes["sources"] = "CNBC (Kurse, Devisen, Dividende), TradingView (Termine, Kursziele, Branche)"
    if changed or not quotes.get("updated"):
        quotes["updated"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    aucrypt.write_enc(F_QUOTES, quotes, ring)

    # --- News (Google News RSS)
    try:
        news = fetch_news(items, quotes, now)
        aucrypt.write_enc(F_NEWS, news, ring)
    except Exception as e:  # noqa
        errors.append(f"News: {e}")
    log(f"{changed} neue Werte; Fehler: {errors or 'keine'}")
    if errors and changed == 0 and not tv and not cq:
        sys.exit(1)


STRIP = re.compile(r"\b(AG|SA|S\.A\.|Inc\.?|Corp\.?|Corporation|Holding|Holdings|Ltd\.?|plc|N\.V\.|SE|Group|Aktiengesellschaft|Co\.?|Class [A-C])\b", re.I)


def news_query(it, meta):
    sid = it["id"]
    name = it.get("newsQuery") or it.get("name") or meta.get("longName") or sid.split(":")[-1]
    if meta.get("type") == "index":
        return f'"{name}" Börse' if sid.startswith("SIX:") else f'"{name}" index', sid.startswith("SIX:")
    base = STRIP.sub("", name).strip(" ,.-") or name
    de = sid.split(":")[0] in ("SIX", "BX", "XETR", "FWB", "VIE")
    return (f'"{base}" Aktie' if de else f'"{base}" stock'), de


def fetch_news(items, quotes, now):
    cutoff = now - timedelta(hours=NEWS_HOURS)
    by_key = {}
    for it in items:
        meta = quotes["symbols"].get(it["id"], {})
        q, de = news_query(it, meta)
        params = "hl=de&gl=CH&ceid=CH:de" if de else "hl=en-US&gl=US&ceid=US:en"
        url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:3d") + "&" + params
        try:
            root = ET.fromstring(http(url, timeout=20))
        except Exception as e:  # noqa
            log(f"News {tag(it['id'])}: {type(e).__name__}")
            continue
        n = 0
        rows = []
        for el in root.iter("item"):
            title = (el.findtext("title") or "").strip()
            link = (el.findtext("link") or "").strip()
            src_el = el.find("source")
            source = (src_el.text or "").strip() if src_el is not None else ""
            try:
                t = parsedate_to_datetime(el.findtext("pubDate")).astimezone(timezone.utc)
            except Exception:  # noqa
                continue
            if t < cutoff or not title or not link.startswith("https://"):
                continue
            if source and title.endswith(" - " + source):
                title = title[: -len(source) - 3].strip()
            rows.append((t, title, link, source))
        rows.sort(reverse=True)
        for t, title, link, source in rows:
            k = re.sub(r"\W+", " ", title.lower()).strip()
            if k in by_key:
                if it["id"] not in by_key[k]["stocks"]:
                    by_key[k]["stocks"].append(it["id"])
                continue
            if n >= NEWS_PER_STOCK:
                continue
            by_key[k] = {"title": title, "link": link, "source": source,
                         "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "stocks": [it["id"]]}
            n += 1
        time.sleep(0.4)
    arts = sorted(by_key.values(), key=lambda a: a["time"], reverse=True)
    return {"version": 1, "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hours": NEWS_HOURS,
            "source": "Google News (RSS)", "articles": arts}


if __name__ == "__main__":
    main()
