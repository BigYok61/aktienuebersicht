'use strict';
// Aktienübersicht – Web-App. Liest die verschlüsselten Dateien unter data/ (AES-256-GCM, PBKDF2-SHA256),
// entschlüsselt im Browser (WebCrypto). Depot nur lokal (localStorage), wird nie übertragen.
const REPO = 'BigYok61/aktienuebersicht';
const FILES = { watch: 'data/watchlist.enc.json', quotes: 'data/quotes.enc.json', news: 'data/news.enc.json' };
const HOURS = [9, 12, 15, 18, 22];
const START = '2026-10-02';
const TZ = 'Europe/Zurich';
const FC = [
  { k: '1d', label: 'Prognose Tagesende', short: 'Tagesende' },
  { k: '7d', label: 'Prognose 7 Tage', short: '7 Tage' },
  { k: '3m', label: 'Prognose 3 Monate', short: '3 Monate' },
  { k: '12m', label: 'Prognose 12 Monate', short: '12 Monate' },
];
const DISCLAIMER = 'Schätzung, keine Anlageberatung';
const LS = { key: 'au.key', token: 'au.ghToken', prefs: 'au.prefs', portfolio: 'au.portfolio', cache: 'au.cache' };
const INDEXES = [
  ['SIX:SMI', 'SMI', '.SSMI'], ['SIX:SLI', 'SLI', '.SLI'], ['SP:SPX', 'S&P 500', '.SPX'], ['NASDAQ:NDX', 'Nasdaq 100', '.NDX'],
  ['NASDAQ:IXIC', 'Nasdaq Composite', '.IXIC'], ['DJ:DJI', 'Dow Jones', '.DJI'], ['XETR:DAX', 'DAX', '.GDAXI'],
  ['TVC:SX5E', 'Euro Stoxx 50', '.STOXX50E'], ['FTSE:UKX', 'FTSE 100', '.FTSE'], ['TVC:NI225', 'Nikkei 225', '.N225'],
];
const EXCH_PREF = ['SIX', 'XETR', 'NASDAQ', 'NYSE', 'AMEX', 'EURONEXT', 'LSE', 'BME', 'MIL', 'VIE', 'TSX'];

// ---------------------------------------------------------------- Formatierung
const nf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf4 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 4 });
const p2 = v => (v == null || !isFinite(v) ? '–' : nf2.format(v));
const p4 = v => (v == null || !isFinite(v) ? '–' : nf4.format(v));
const pct = v => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + nf2.format(v) + ' %');
const sgn = v => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + nf2.format(v));
const pad = h => String(h).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function zurichToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function weekdayKeys(from, to) {
  const out = []; const d = new Date(from + 'T12:00:00Z'); const end = new Date(to + 'T12:00:00Z');
  while (d <= end) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
function addDays(k, n) { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const hdrFmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', timeZone: 'UTC' });
const header = k => { const d = new Date(k + 'T12:00:00Z'); return `${hdrFmt.format(d).replace('.', '')} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
const dmy = k => (k ? `${+k.slice(8, 10)}.${+k.slice(5, 7)}.${k.slice(0, 4)}` : '–');
const dmyShort = k => `${+k.slice(8, 10)}.${+k.slice(5, 7)}.${k.slice(2, 4)}`;
const timeFmt = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const newsFmt = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- Verschlüsselung (Format: scripts/aucrypt.py)
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = b => { let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
let cryptoKey = null, keySalt = null, keyIter = null;
async function deriveKey(pw, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(saltB64), iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function decryptBlob(blob) {
  if (!cryptoKey || blob.salt !== keySalt || blob.iter !== keyIter) throw new Error('KEY');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, cryptoKey, b64d(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function encryptObj(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: keyIter, salt: keySalt, iv: b64e(iv), ct: b64e(ct) };
}
async function fetchBlob(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function restoreKey() {
  try {
    const s = JSON.parse(localStorage.getItem(LS.key) || 'null');
    if (!s) return false;
    cryptoKey = await crypto.subtle.importKey('raw', b64d(s.key), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    keySalt = s.salt; keyIter = s.iter; return true;
  } catch { return false; }
}
async function unlock(pw, remember) {
  const blob = await fetchBlob(FILES.watch);
  cryptoKey = await deriveKey(pw, blob.salt, blob.iter); keySalt = blob.salt; keyIter = blob.iter;
  try { await decryptBlob(blob); } catch { cryptoKey = null; throw new Error('Falsches Passwort.'); }
  if (remember) localStorage.setItem(LS.key, JSON.stringify({ salt: keySalt, iter: keyIter, key: b64e(await crypto.subtle.exportKey('raw', cryptoKey)) }));
  else localStorage.removeItem(LS.key);
}
function logout() {
  localStorage.removeItem(LS.key); localStorage.removeItem(LS.cache); cryptoKey = null;
  watch = { items: [], categories: [] }; quotes = { days: {}, symbols: {} }; news = { articles: [] };
  showLogin('Abgemeldet.');
}

// ---------------------------------------------------------------- Zustand
let watch = { items: [], categories: [] }, quotes = { days: {}, symbols: {} }, news = { articles: [] };
let live = { prices: {}, fx: {}, time: null, ok: false };
let editing = false;
const prefs = Object.assign({ sort: 'cat', order: [], showFc: true, newsFilter: '', newsGroup: false }, JSON.parse(localStorage.getItem(LS.prefs) || '{}'));
const savePrefs = () => localStorage.setItem(LS.prefs, JSON.stringify(prefs));
let portfolio = loadPortfolio();
function loadPortfolio() { try { return Object.assign({ version: 1, lots: {} }, JSON.parse(localStorage.getItem(LS.portfolio) || '{}')); } catch { return { version: 1, lots: {} }; } }
function savePortfolio() { portfolio.updated = new Date().toISOString(); localStorage.setItem(LS.portfolio, JSON.stringify(portfolio)); }

const meta = id => quotes.symbols?.[id] || {};
const itemName = it => it.name || meta(it.id).name || it.id;
const ticker = id => id.split(':').pop();
const isIndex = id => meta(id).type === 'index' || INDEXES.some(x => x[0] === id);
function ccyInfo(c) { if (c === 'GBX' || c === 'GBp') return ['GBP', 0.01]; if (c === 'ILA') return ['ILS', 0.01]; if (c === 'ZAC') return ['ZAR', 0.01]; return [c || 'CHF', 1]; }
const ccyLabel = id => (isIndex(id) ? 'Punkte' : (meta(id).currency || ''));
const val = (id, k, h) => quotes.days?.[k]?.slots?.[pad(h)]?.[id] ?? null;
const fxAt = (ccy, k, h) => (ccy === 'CHF' ? 1 : quotes.days?.[k]?.fx?.[pad(h)]?.[ccy] ?? null);
const closeOf = (id, k) => quotes.days?.[k]?.close?.[id] ?? null;
const fcOf = (id, k, f) => quotes.days?.[k]?.fc?.[f]?.[id] ?? null;
function addMonths(k, n) {
  const [y, m, d] = k.split('-').map(Number); const mm = m - 1 + n; const yy = y + Math.floor(mm / 12); const mo = ((mm % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mo + 1, 0)).getUTCDate();
  return `${yy}-${pad(mo + 1)}-${pad(Math.min(d, last))}`;
}
function targetOf(k, f) {
  const t = quotes.days?.[k]?.targets?.[f];
  if (t) return t;
  return f === '1d' ? k : f === '7d' ? addDays(k, 7) : f === '3m' ? addMonths(k, 3) : addMonths(k, 12);
}
/** Ist-Wert zur Prognose: Schlusskurs am Zieltag, sonst nächster Handelstag (bis 5 Tage später) */
function actualOf(id, k, f) {
  const t = targetOf(k, f);
  for (let i = 0; i <= 5; i++) { const d = addDays(t, i); const c = closeOf(id, d); if (c != null) return { v: c, day: d }; }
  return null;
}
function latestRecorded(id) {
  const ks = Object.keys(quotes.days || {}).sort().reverse();
  for (const k of ks) for (const h of [...HOURS].reverse()) { const v = val(id, k, h); if (v != null) return { v, k, h }; }
  return null;
}
function latestFx(ccy) {
  if (ccy === 'CHF') return { v: 1 };
  const ks = Object.keys(quotes.days || {}).sort().reverse();
  for (const k of ks) for (const h of [...HOURS].reverse()) { const v = fxAt(ccy, k, h); if (v != null) return { v, k, h }; }
  return null;
}
/** Aktueller Kurs: live (TradingView), sonst letzter erfasster Wert (gekennzeichnet) */
function nowPrice(id) {
  if (live.prices[id] != null) return { v: live.prices[id], live: true, time: live.time };
  const r = latestRecorded(id); return r ? { v: r.v, live: false, k: r.k, h: r.h } : null;
}
function nowFx(ccy) {
  if (ccy === 'CHF') return { v: 1, live: true };
  if (live.fx[ccy] != null) return { v: live.fx[ccy], live: true };
  const r = latestFx(ccy); return r ? { ...r, live: false } : null;
}

// ---------------------------------------------------------------- Depot
function lotsOf(id) { return portfolio.lots[id] || []; }
function holding(id) {
  const lots = lotsOf(id); if (!lots.length) return null;
  const [base, unit] = ccyInfo(meta(id).currency);
  let qty = 0, cost = 0, costChf = 0, costChfOk = true;
  for (const l of lots) {
    qty += +l.qty; cost += l.qty * l.price;
    const fx = base === 'CHF' ? 1 : l.fx; if (fx == null) costChfOk = false; else costChf += l.qty * l.price * unit * fx;
  }
  const avg = qty ? cost / qty : null;
  const p = nowPrice(id), fx = nowFx(base);
  const value = p && fx ? qty * p.v * unit * fx.v : null;
  return { qty, avg, costChf: costChfOk ? costChf : null, value, gain: value != null && costChfOk ? value - costChf : null,
    gainPct: value != null && costChfOk && costChf ? (value / costChf - 1) * 100 : null, live: p?.live && fx?.live };
}
function slotValueChf(k, h) {
  let total = 0, any = false;
  for (const id of Object.keys(portfolio.lots)) {
    const lots = lotsOf(id); if (!lots.length) continue;
    const qty = lots.reduce((s, l) => s + (l.date <= k ? +l.qty : 0), 0); if (!qty) continue;
    const v = val(id, k, h); const [base, unit] = ccyInfo(meta(id).currency); const fx = fxAt(base, k, h);
    if (v == null || fx == null) return null;
    total += qty * v * unit * fx; any = true;
  }
  return any ? total : null;
}
async function fxOnDate(ccy, date) {
  if (ccy === 'CHF') return 1;
  const r = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${ccy}&symbols=CHF`);
  if (!r.ok) throw new Error(`Frankfurter HTTP ${r.status}`);
  const j = await r.json(); return j.rates?.CHF ?? null;
}

// ---------------------------------------------------------------- Reihenfolge / Kategorien
const catOf = it => it.category || meta(it.id).suggestedCategory || 'Sonstige';
function orderedItems() {
  const items = [...(watch.items || [])];
  if (prefs.sort === 'alpha') return items.sort((a, b) => itemName(a).localeCompare(itemName(b), 'de-CH'));
  if (prefs.sort === 'manual') {
    if (canEdit() || !prefs.order.length) return items;
    const pos = id => { const i = prefs.order.indexOf(id); return i < 0 ? 1e6 : i; };
    return items.map((it, i) => [it, i]).sort((a, b) => (pos(a[0].id) - pos(b[0].id)) || (a[1] - b[1])).map(x => x[0]);
  }
  const cats = [...(watch.categories || [])];
  for (const it of items) if (!cats.includes(catOf(it))) cats.push(catOf(it));
  return items.sort((a, b) => (cats.indexOf(catOf(a)) - cats.indexOf(catOf(b))) || itemName(a).localeCompare(itemName(b), 'de-CH'));
}
function categoryChoices() {
  const s = [...(watch.categories || [])];
  for (const it of watch.items || []) if (!s.includes(catOf(it))) s.push(catOf(it));
  for (const d of ['Indizes', 'Tech', 'Auto', 'Pharma', 'Banken', 'Konsum', 'Industrie']) if (!s.includes(d)) s.push(d);
  return s;
}
function categoryFor(sector, industry, type) { // identisch mit capture.py / Swift
  const s = (sector || '').toLowerCase(), i = (industry || '').toLowerCase();
  if (type === 'index') return 'Indizes';
  if (i.includes('motor vehicle') || i.includes('auto')) return 'Auto';
  if (['electronic technology', 'technology services'].includes(s)) return 'Tech';
  if (['health technology', 'health services'].includes(s)) return 'Pharma';
  if (s === 'finance') return 'Banken';
  if (['consumer non-durables', 'consumer durables', 'retail trade', 'consumer services'].includes(s)) return 'Konsum';
  if (['producer manufacturing', 'industrial services', 'process industries', 'non-energy minerals', 'transportation', 'commercial services'].includes(s)) return 'Industrie';
  if (['energy minerals', 'utilities'].includes(s)) return 'Energie';
  if (s === 'communications') return 'Telekom';
  return 'Sonstige';
}

// ---------------------------------------------------------------- Dividende / Kursziel
function dividendHtml(id) {
  const d = quotes.dividends?.[id];
  if (isIndex(id)) return '';
  if (!d || d.status === 'unknown') return '<span class="k">Dividende:</span> unbekannt';
  if (d.status === 'none') return '<span class="k">Dividende:</span> keine Dividende';
  const ccy = meta(id).currency || '';
  const tip = [];
  if (d.nextEx) {
    tip.push(`Nächste Dividende${d.nextEstimated ? ' (geschätzt aus bisherigem Zahlungsrhythmus)' : ''}:`);
    tip.push(`Ex-Tag: ${dmy(d.nextEx)}${d.nextEstimated ? ' (geschätzt)' : ''}`);
    tip.push(`Zahltag: ${d.nextPay ? dmy(d.nextPay) + (d.nextEstimated ? ' (geschätzt)' : '') : 'unbekannt'}`);
    if (d.nextAmount) tip.push(`Betrag: ${p2(d.nextAmount)} ${ccy}`);
  } else tip.push('Nächster Termin: unbekannt');
  if (d.lastEx) tip.push(`Letzte: Ex ${dmy(d.lastEx)}${d.lastPay ? ', Zahlung ' + dmy(d.lastPay) : ''}${d.lastAmount ? `, ${p2(d.lastAmount)} ${ccy}${d.lastAmountEstimated ? ' (berechnet)' : ''}` : ''}`);
  if (d.frequency) tip.push(`Rhythmus: ${{ 1: 'jährlich', 2: 'halbjährlich', 4: 'vierteljährlich', 12: 'monatlich' }[d.frequency]}`);
  tip.push(`Quelle: ${d.source || '–'}, Stand ${dmy(d.asOf)}`);
  return `<span class="hint" title="${esc(tip.join('\n'))}"><span class="k">Dividende:</span> ${p2(d.annual)} ${esc(ccy)} · ${d.yield != null ? nf2.format(d.yield) + ' %' : '–'}</span>`;
}
function targetHtml(id) {
  if (isIndex(id)) return '';
  const t = quotes.targets?.[id];
  if (!t || t.mean == null) return '<span class="k">Kursziel Analysten 12 Mt.:</span> keine Daten';
  const p = nowPrice(id); const up = p ? (t.mean / p.v - 1) * 100 : null;
  const tip = [`Konsens-Kursziel (Mittelwert) 12 Monate: ${p2(t.mean)} ${t.currency || ''}`,
    t.median != null ? `Median: ${p2(t.median)}` : null,
    t.low != null && t.high != null ? `Spanne: ${p2(t.low)} – ${p2(t.high)}` : null,
    t.count ? `Analysten: ${t.count}` : null,
    p ? `Potenzial gegenüber ${p.live ? 'aktuellem' : 'letztem erfassten'} Kurs ${p2(p.v)}: ${pct(up)}` : null,
    `Quelle: ${t.source}, Stand ${dmy(t.asOf)}`, 'Keine Anlageberatung'].filter(Boolean);
  return `<span class="hint" title="${esc(tip.join('\n'))}"><span class="k">Kursziel Analysten 12 Mt.:</span> ${p2(t.mean)} <span class="${up > 0 ? 'up' : up < 0 ? 'down' : ''}">(${pct(up)})</span></span>`;
}

// ---------------------------------------------------------------- Tabelle
function arrowFor(d, eps) { return d > eps ? '<span class="arr up">▲</span>' : d < -eps ? '<span class="arr down">▼</span>' : '<span class="arr flat">–</span>'; }
function render() {
  const today = zurichToday();
  const days = weekdayKeys(START, today < START ? START : today);
  for (const k of Object.keys(quotes.days || {})) if (k >= START && !days.includes(k) && k <= addDays(today, 1)) days.push(k);
  days.sort();
  const extra = 2; // Jetzt + Wert CHF
  const td = (k, html, cls = '', title = '') => `<td class="${k === today ? 'today ' : ''}${cls}"${title ? ` title="${esc(title)}"` : ''}>${html}</td>`;
  const blanks = (cls = '') => days.map(k => td(k, '', cls)).join('');
  const liveHead = live.ok && live.time ? `Jetzt ${hmFmt.format(live.time)}` : 'Jetzt';
  let h = '<thead><tr><th class="lab">Zeit (CH)</th>' + days.map(k => `<th class="${k === today ? 'today' : ''}">${header(k)}</th>`).join('') +
    `<th class="now" title="${live.ok ? 'Aktueller Kurs (TradingView, bis 15 Min. verzögert), abgerufen ' + timeFmt.format(live.time) : 'Kein Live-Kurs verfügbar: letzter erfasster Wert'}">${liveHead}</th><th class="val">Wert CHF</th></tr></thead><tbody>`;

  // Depot (nur wenn Bestände vorhanden)
  const held = (watch.items || []).filter(it => lotsOf(it.id).length);
  if (held.length) {
    let tv = 0, tc = 0, okv = true, okc = true, allLive = true;
    for (const it of held) { const x = holding(it.id); if (x.value == null) okv = false; else tv += x.value; if (x.costChf == null) okc = false; else tc += x.costChf; if (!x.live) allLive = false; }
    h += `<tr class="sect"><th class="lab">Depot (CHF)</th>${blanks()}<td class="now"></td><td class="val"></td></tr>`;
    HOURS.forEach((hr, i) => {
      h += `<tr class="${i % 2 ? 'alt' : ''}"><th class="lab">Depotwert ${pad(hr)}:00</th>` + days.map(k => { const v = slotValueChf(k, hr); return td(k, v == null ? '–' : p2(v), v == null ? 'empty' : '', v == null ? '' : 'Bestand × Kurs × Devisenkurs zum Zeitpunkt'); }).join('') + '<td class="now"></td><td class="val"></td></tr>';
    });
    const g = okv && okc ? tv - tc : null;
    h += `<tr class="total"><th class="lab">Total Depot</th>${blanks()}<td class="now"></td><td class="val${allLive ? '' : ' fallback'}" title="${esc(`Einstand CHF: ${okc ? p2(tc) : 'unvollständig'}\nGewinn/Verlust: ${sgn(g)} CHF (${pct(g != null && tc ? (tv / tc - 1) * 100 : null)})${allLive ? '' : '\nTeilweise letzter erfasster Kurs statt Live-Kurs'}`)}">${okv ? p2(tv) : '–'}<br><span class="pct ${g > 0 ? 'up' : g < 0 ? 'down' : ''}">${sgn(g)} (${pct(g != null && tc ? (tv / tc - 1) * 100 : null)})</span></td></tr>`;
  }

  let lastCat = null;
  for (const it of orderedItems()) {
    const id = it.id, m = meta(id);
    if (prefs.sort === 'cat' && catOf(it) !== lastCat) { lastCat = catOf(it); h += `<tr class="sect"><th class="lab">${esc(lastCat)}</th>${blanks()}<td class="now"></td><td class="val"></td></tr>`; }
    const hold = holding(id);
    const np = nowPrice(id);
    const base09 = val(id, today, HOURS[0]);
    const nowTitle = np ? (np.live ? `Aktueller Kurs (TradingView), ${timeFmt.format(np.time)}` : `Kein Live-Kurs: letzter erfasster Wert ${header(np.k)} ${pad(np.h)}:00`) : '';
    const nowCell = np ? `<td class="now${np.live ? '' : ' fallback'}" title="${esc(nowTitle + (base09 != null ? `\nVeränderung seit 09:00: ${sgn(np.v - base09)} (${pct((np.v / base09 - 1) * 100)})` : ''))}">${p2(np.v)}${np.live ? '' : ' *'}</td>` : '<td class="now empty">–</td>';
    const valCell = hold ? `<td class="val${hold.live ? '' : ' fallback'}" title="${esc(`Anzahl ${nf0.format(hold.qty)} · Ø Kaufpreis ${p2(hold.avg)} ${m.currency || ''}\nEinstand CHF (Devisenkurs am Kaufdatum): ${p2(hold.costChf)}\nGewinn/Verlust: ${sgn(hold.gain)} CHF (${pct(hold.gainPct)})`)}">${p2(hold.value)}</td>` : '<td class="val"></td>';
    const status = m.status && m.status !== 'ok' ? ` <span class="badge" title="Symbol wird beim nächsten Abruf geprüft">${esc(m.status)}</span>` : '';
    h += `<tr class="group"><th class="lab" title="${esc(`${m.longName || itemName(it)} · ${id}${m.exchange ? ' · ' + m.exchange : ''} · Kategorie: ${catOf(it)}`)}">${esc(itemName(it))}<span class="tick">${esc(ticker(id))} · ${esc(ccyLabel(id))}</span>${status}</th>${blanks()}${nowCell}${valCell}</tr>`;
    const divH = dividendHtml(id), tgtH = targetHtml(id);
    const holdLine = hold ? `<br><span class="k">Anzahl:</span> ${nf0.format(hold.qty)} · <span class="k">Ø Kauf:</span> ${p2(hold.avg)}` : '';
    if (divH || tgtH || hold) {
      h += `<tr class="info"><th class="lab">${[divH, tgtH].filter(Boolean).join('<br>')}${holdLine}</th>${blanks()}<td class="now"></td>` +
        (hold ? `<td class="val"><span class="${hold.gain > 0 ? 'up' : hold.gain < 0 ? 'down' : ''}">${sgn(hold.gain)}<br>${pct(hold.gainPct)}</span></td>` : '<td class="val"></td>') + '</tr>';
    }
    const slotRow = (hr, alt) => {
      let row = `<tr class="${alt ? 'alt' : ''}"><th class="lab">${pad(hr)}:00</th>`;
      for (const k of days) {
        const v = val(id, k, hr), b = val(id, k, HOURS[0]);
        let arrow = '', title = '';
        if (v != null && b != null && hr !== HOURS[0]) { const d = v - b; arrow = arrowFor(d, Math.abs(b) * 1e-5); title = `Veränderung seit 09:00: ${sgn(d)} ${ccyLabel(id)} (${pct((v / b - 1) * 100)})`; }
        row += td(k, v == null ? '–' : arrow + p2(v), v == null ? 'empty' : '', title);
      }
      return row + '<td class="now"></td><td class="val"></td></tr>';
    };
    h += slotRow(HOURS[0], false);
    if (prefs.showFc) {
      for (const f of FC) {
        h += `<tr class="fc"><th class="lab" title="${DISCLAIMER}">${f.label} *</th>`;
        for (const k of days) {
          const v = fcOf(id, k, f.k), b = val(id, k, HOURS[0]);
          let arrow = ''; if (v != null && b != null) { const d = v - b; arrow = `<span class="fcarr">${d > Math.abs(b) * 1e-5 ? '↑' : d < -Math.abs(b) * 1e-5 ? '↓' : '→'}</span>`; }
          h += td(k, v == null ? '–' : arrow + p2(v), v == null ? 'empty' : '', v == null ? '' : `${DISCLAIMER}\nZiel: ${f.k === '1d' ? 'Schlusskurs ' + header(k) : 'Schlusskurs ' + dmy(targetOf(k, f.k))}\nBasis 09:00: ${p2(b)}${b ? ` (${pct((v / b - 1) * 100)})` : ''}`);
        }
        h += '<td class="now"></td><td class="val"></td></tr>';
      }
      for (const f of FC) {
        h += `<tr class="dev"><th class="lab">Abweichung ${f.short}</th>`;
        for (const k of days) {
          const v = fcOf(id, k, f.k);
          if (v == null) { h += td(k, '–', 'empty'); continue; }
          const a = actualOf(id, k, f.k);
          if (a) { const d = a.v - v; h += td(k, sgn(d), '', `Ist (Schlusskurs ${dmy(a.day)}): ${p2(a.v)} · Prognose: ${p2(v)} · Abweichung ${pct((a.v / v - 1) * 100)}`); }
          else h += td(k, f.k === '1d' ? '→ Schluss' : `→ ${dmyShort(targetOf(k, f.k))}`, 'empty pending', `Ist-Wert ab ${dmy(targetOf(k, f.k))} (Schlusskurs)`);
        }
        h += '<td class="now"></td><td class="val"></td></tr>';
      }
    }
    HOURS.slice(1).forEach((hr, i) => { h += slotRow(hr, i % 2 === 0); });
    h += `<tr class="dev"><th class="lab">Schlusskurs</th>${days.map(k => { const c = closeOf(id, k); return td(k, c == null ? '–' : p2(c), c == null ? 'empty' : ''); }).join('')}<td class="now"></td><td class="val"></td></tr>`;
  }
  if (!(watch.items || []).length) h += `<tr><th class="lab">Watchlist leer</th>${blanks()}<td></td><td></td></tr>`;
  document.getElementById('grid').innerHTML = h + '</tbody>';
  const sc = document.getElementById('scroller'); sc.scrollLeft = sc.scrollWidth;
  const upd = quotes.updated ? new Date(quotes.updated) : null;
  document.getElementById('stand').textContent = upd ? `Stand: ${timeFmt.format(upd)} Uhr (Schweizer Zeit)` : 'Noch keine Kursdaten erfasst';
  document.getElementById('updated').textContent = live.ok ? `Jetzt-Kurse: ${timeFmt.format(live.time)}` : 'Jetzt-Kurse nicht verfügbar – * = letzter erfasster Wert';
  document.getElementById('sort').value = prefs.sort;
  document.getElementById('showFc').checked = prefs.showFc;
  renderNews();
  if (editing) renderEditor();
}

// ---------------------------------------------------------------- News
function renderNews() {
  const sel = document.getElementById('newsFilter');
  const items = orderedItems();
  sel.innerHTML = '<option value="">Alle Aktien</option>' + items.map(it => `<option value="${esc(it.id)}">${esc(itemName(it))}</option>`).join('');
  sel.value = items.some(it => it.id === prefs.newsFilter) ? prefs.newsFilter : '';
  document.getElementById('newsGroup').checked = prefs.newsGroup;
  const cutoff = Date.now() - (news.hours || 72) * 3600e3;
  const ids = new Set(items.map(i => i.id));
  const arts = (news.articles || []).filter(a => new Date(a.time) >= cutoff && a.stocks.some(s => ids.has(s)) && (!sel.value || a.stocks.includes(sel.value)));
  const nameOf = id => itemName(items.find(i => i.id === id) || { id });
  const li = a => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a><div class="meta">${esc(a.source || '–')} · ${newsFmt.format(new Date(a.time))} Uhr${a.stocks.map(s => `<span class="badge">${esc(nameOf(s))}</span>`).join('')}</div></li>`;
  let html = '';
  if (!arts.length) html = '<p class="sub">Keine Artikel aus den letzten 72 Stunden.</p>';
  else if (prefs.newsGroup && !sel.value) {
    for (const it of items) { const a = arts.filter(x => x.stocks.includes(it.id)); if (a.length) html += `<h3>${esc(itemName(it))}</h3><ul>${a.map(li).join('')}</ul>`; }
  } else html = `<ul>${arts.map(li).join('')}</ul>`;
  document.getElementById('newsList').innerHTML = html;
  document.getElementById('newsInfo').textContent = news.updated ? `letzte 72 Stunden · Quelle: ${news.source || 'Google News'} · Stand ${timeFmt.format(new Date(news.updated))}` : '';
}

// ---------------------------------------------------------------- Laden
function showError(msg) { const e = document.getElementById('error'); e.hidden = !msg; e.textContent = msg || ''; e.className = 'error'; }
function showOk(msg) { const e = document.getElementById('error'); e.hidden = !msg; e.textContent = msg || ''; e.className = 'ok'; }
async function load() {
  try {
    const [w, q, n] = await Promise.all([fetchBlob(FILES.watch), fetchBlob(FILES.quotes), fetchBlob(FILES.news).catch(() => null)]);
    if (w.salt !== keySalt) { logout(); showLogin('Das Passwort wurde geändert. Bitte neu anmelden.'); return; }
    watch = await decryptBlob(w); quotes = await decryptBlob(q); news = n ? await decryptBlob(n) : { articles: [] };
    try { localStorage.setItem(LS.cache, JSON.stringify({ w, q, n })); } catch { /* Speicher voll */ }
    showError('');
  } catch (e) {
    if (e.name === 'OperationError') { logout(); showLogin('Entschlüsselung fehlgeschlagen. Bitte Passwort neu eingeben.'); return; }
    showError(navigator.onLine === false ? 'Keine Internetverbindung. Es werden die zuletzt geladenen Daten angezeigt.' : `Die Daten konnten nicht geladen werden (${e.message}).`);
  }
  render();
  loadLive();
}
async function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS.cache) || 'null'); if (!c) return;
    watch = await decryptBlob(c.w); quotes = await decryptBlob(c.q); news = c.n ? await decryptBlob(c.n) : { articles: [] };
    render();
  } catch { /* ignorieren */ }
}
async function tvScan(tickers, columns) {
  const r = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ symbols: { tickers }, columns }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).data || [];
}
async function loadLive() {
  const ids = (watch.items || []).map(i => i.id); if (!ids.length) return;
  const ccys = [...new Set(ids.map(id => ccyInfo(meta(id).currency)[0]).filter(c => c && c !== 'CHF'))];
  try {
    const data = await tvScan([...ids, ...ccys.map(c => `FX_IDC:${c}CHF`)], ['close', 'update_time']);
    const prices = {}, fx = {}; let newest = 0;
    for (const x of data) {
      if (x.s.startsWith('FX_IDC:')) fx[x.s.slice(7, 10)] = x.d[0];
      else if (x.d[0] != null) { prices[x.s] = x.d[0]; newest = Math.max(newest, x.d[1] || 0); }
    }
    live = { prices, fx, time: new Date(), ok: Object.keys(prices).length > 0 };
  } catch { live = { prices: {}, fx: {}, time: null, ok: false }; }
  render();
}

// ---------------------------------------------------------------- Watchlist bearbeiten
const token = () => localStorage.getItem(LS.token) || '';
const canEdit = () => !!token();
async function ghGetWatch() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILES.watch}?ref=main`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 401 ? 'Token ungültig oder abgelaufen' : `GitHub HTTP ${r.status}`);
  const j = await r.json();
  const blob = JSON.parse(new TextDecoder().decode(b64d(j.content.replace(/\n/g, ''))));
  return { sha: j.sha, blob };
}
/** Änderung auf den aktuellen Stand im Repo anwenden, neu verschlüsseln und committen (bei Konflikt erneut) */
async function commitWatch(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, blob } = await ghGetWatch();
    if (blob.salt !== keySalt) throw new Error('Passwort im Repo wurde geändert – bitte neu anmelden');
    const cur = await decryptBlob(blob);
    mutate(cur);
    const enc = await encryptObj(cur);
    const body = { message, sha, branch: 'main', content: b64e(new TextEncoder().encode(JSON.stringify(enc, null, 1) + '\n')) };
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILES.watch}`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { watch = cur; return; }
    if (r.status !== 409 && r.status !== 422) throw new Error(r.status === 403 ? 'Token ohne Schreibrecht (Contents: Read and write)' : `GitHub HTTP ${r.status}`);
  }
  throw new Error('Konflikt beim Speichern – bitte erneut versuchen');
}
async function edit(mutate, message) {
  try {
    showOk('Speichere …');
    await commitWatch(mutate, message);
    showOk('Gespeichert. Kurse neuer Titel erscheinen nach dem nächsten Abruf (ca. 2–4 Minuten).');
    render();
  } catch (e) { showError(`Speichern fehlgeschlagen: ${e.message}`); }
}
let searchResults = [];
async function search(q) {
  q = q.trim(); if (!q) { searchResults = []; return renderEditor(); }
  const ql = q.toLowerCase();
  const idx = INDEXES.filter(([id, n]) => n.toLowerCase().includes(ql) || id.toLowerCase().includes(ql)).map(([id, n, c]) => ({ id, name: n, desc: 'Index', exchange: id.split(':')[0], type: 'index', currency: '', cnbc: c, category: 'Indizes' }));
  const cols = ['name', 'description', 'exchange', 'type', 'currency', 'close', 'sector', 'industry'];
  const res = [];
  try {
    if (/^[A-Z_]+:[A-Z0-9.\-_/]+$/i.test(q)) {
      for (const x of await tvScan([q.toUpperCase()], cols)) res.push(x);
    } else {
      const body = { filter: [{ left: 'name,description', operation: 'match', right: q }, { left: 'type', operation: 'in_range', right: ['stock', 'dr', 'fund'] },
        { left: 'exchange', operation: 'in_range', right: EXCH_PREF }], columns: cols, sort: { sortBy: 'market_cap_basic', sortOrder: 'desc', nullsFirst: false }, range: [0, 30] };
      const r = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
      res.push(...((await r.json()).data || []));
    }
  } catch (e) { showError(`Suche fehlgeschlagen (${e.message}). Ticker im Format BÖRSE:TICKER eingeben, z. B. SIX:NESN.`); }
  const list = res.map(x => { const d = Object.fromEntries(cols.map((c, i) => [c, x.d[i]])); return { id: x.s, name: d.description, desc: d.description, exchange: d.exchange, type: d.type, currency: d.currency, close: d.close, category: categoryFor(d.sector, d.industry, d.type) }; })
    .filter(r => !(r.exchange === 'MIL' && /^1/.test(ticker(r.id))) && !(r.exchange === 'LSE' && /^0/.test(ticker(r.id))));
  list.sort((a, b) => EXCH_PREF.indexOf(a.exchange) - EXCH_PREF.indexOf(b.exchange));
  searchResults = [...idx, ...list].slice(0, 15);
  if (!searchResults.length) showError(`Kein Titel gefunden für „${q}“.`);
  renderEditor();
}
function renderEditor() {
  const el = document.getElementById('editor'); el.hidden = !editing;
  document.getElementById('editBtn').classList.toggle('on', editing);
  if (!editing) return;
  const rw = canEdit();
  const items = orderedItems();
  const cats = categoryChoices();
  let h = `<h2>Watchlist bearbeiten</h2>`;
  h += rw ? '<p class="sub">Änderungen werden verschlüsselt im Repository gespeichert und gelten für Web- und Mac-App.</p>'
    : '<p class="sub">Nur-Lesen: Ohne GitHub-Token lässt sich nur die Reihenfolge auf diesem Gerät ändern. Token unten eintragen, um Titel hinzuzufügen, zu löschen oder Kategorien zu ändern.</p>';
  h += `<p class="sub">Sortierung „Eigene Reihenfolge“: Zeilen ziehen oder mit ▲▼ verschieben.</p><ul class="wl" id="wl">`;
  const manual = prefs.sort === 'manual';
  for (const it of manual ? items : orderedItemsManual()) {
    h += `<li draggable="true" data-id="${esc(it.id)}"><span class="grip" title="Ziehen">≡</span><span class="nm">${esc(itemName(it))} <span class="tick">${esc(it.id)}</span></span>
      <button data-up="${esc(it.id)}" title="nach oben">▲</button><button data-down="${esc(it.id)}" title="nach unten">▼</button>
      <select data-cat="${esc(it.id)}" ${rw ? '' : 'disabled'}>${cats.map(c => `<option ${c === catOf(it) ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">Neue Kategorie …</option></select>
      <button class="danger" data-del="${esc(it.id)}" ${rw ? '' : 'disabled'} title="Löschen">✕</button></li>`;
  }
  h += '</ul>';
  if (rw) {
    h += `<div class="row"><input id="q" placeholder="Name oder Ticker (z. B. Siemens, SIX:NESN)" size="34"><button id="qBtn">Suchen</button></div><ul class="results">` +
      searchResults.map((r, i) => `<li><span>${esc(r.name)} <span class="tick">${esc(r.id)} · ${esc(r.type === 'index' ? 'Index' : r.currency || '')}${r.close != null ? ' · ' + p2(r.close) : ''} · ${esc(r.category)}</span></span>${(watch.items || []).some(x => x.id === r.id) ? '<span class="sub">vorhanden</span>' : `<button data-add="${i}">Hinzufügen</button>`}</li>`).join('') + '</ul>';
    h += `<div class="row"><button id="newCat">Neue Kategorie</button><button id="tokOut" class="danger">Token entfernen</button></div>`;
  } else {
    h += `<div class="row"><input id="tok" type="password" placeholder="GitHub-Token (github_pat_…)" size="34" autocomplete="off"><button id="tokSave">Token speichern</button></div>
      <p class="small">Der Token wird nur in diesem Browser gespeichert (localStorage) und nur an api.github.com gesendet.</p>`;
  }
  el.innerHTML = h;
  wireEditor();
}
function orderedItemsManual() { const s = prefs.sort; prefs.sort = 'manual'; const r = orderedItems(); prefs.sort = s; return r; }
function moveTo(ids) {
  if (canEdit()) edit(cur => { const by = Object.fromEntries(cur.items.map(i => [i.id, i])); cur.items = [...ids.filter(i => by[i]).map(i => by[i]), ...cur.items.filter(i => !ids.includes(i.id))]; }, 'Watchlist geändert');
  else { prefs.order = ids; savePrefs(); render(); }
  if (prefs.sort !== 'manual') { prefs.sort = 'manual'; savePrefs(); }
}
function wireEditor() {
  const el = document.getElementById('editor');
  const ids = [...el.querySelectorAll('#wl li')].map(li => li.dataset.id);
  el.querySelectorAll('[data-up],[data-down]').forEach(b => b.onclick = () => {
    const id = b.dataset.up || b.dataset.down, i = ids.indexOf(id), j = b.dataset.up ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; moveTo(ids);
  });
  let dragId = null;
  el.querySelectorAll('#wl li').forEach(li => {
    li.ondragstart = e => { dragId = li.dataset.id; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; };
    li.ondragend = () => li.classList.remove('drag');
    li.ondragover = e => { e.preventDefault(); li.classList.add('over'); };
    li.ondragleave = () => li.classList.remove('over');
    li.ondrop = e => { e.preventDefault(); li.classList.remove('over'); if (!dragId || dragId === li.dataset.id) return; const a = ids.filter(x => x !== dragId); a.splice(a.indexOf(li.dataset.id), 0, dragId); moveTo(a); };
  });
  el.querySelectorAll('[data-cat]').forEach(s => s.onchange = () => {
    let c = s.value; if (c === '__new') { c = (prompt('Name der neuen Kategorie:') || '').trim(); if (!c) return render(); }
    edit(cur => { const it = cur.items.find(i => i.id === s.dataset.cat); if (it) it.category = c; if (!cur.categories.includes(c)) cur.categories.push(c); }, 'Watchlist geändert');
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const it = watch.items.find(i => i.id === b.dataset.del);
    if (confirm(`${itemName(it)} aus der Watchlist löschen? Der bisherige Kursverlauf bleibt gespeichert.`)) edit(cur => { cur.items = cur.items.filter(i => i.id !== b.dataset.del); }, 'Watchlist geändert');
  });
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const r = searchResults[+b.dataset.add];
    const name = r.type === 'index' ? r.name : r.name.replace(/\s+(AG|SA|S\.A\.|Inc\.?|Corp\.?|Corporation|Holding Ltd|Ltd\.?|plc|SE|N\.V\.)$/i, '');
    edit(cur => { if (cur.items.some(i => i.id === r.id)) return; const item = { id: r.id, name, category: r.category, added: zurichToday() }; if (r.cnbc) item.cnbc = r.cnbc; cur.items.push(item); if (!cur.categories.includes(r.category)) cur.categories.push(r.category); }, 'Watchlist geändert');
    searchResults = [];
  });
  const q = el.querySelector('#q'); if (q) { q.onkeydown = e => { if (e.key === 'Enter') search(q.value); }; el.querySelector('#qBtn').onclick = () => search(q.value); }
  const nc = el.querySelector('#newCat'); if (nc) nc.onclick = () => { const c = (prompt('Name der neuen Kategorie:') || '').trim(); if (c) edit(cur => { if (!cur.categories.includes(c)) cur.categories.push(c); }, 'Watchlist geändert'); };
  const ts = el.querySelector('#tokSave'); if (ts) ts.onclick = async () => {
    const t = el.querySelector('#tok').value.trim(); if (!t) return;
    localStorage.setItem(LS.token, t);
    try { await ghGetWatch(); showOk('Token gespeichert – Bearbeiten ist aktiv.'); } catch (e) { localStorage.removeItem(LS.token); showError(`Token abgelehnt: ${e.message}`); }
    render();
  };
  const to = el.querySelector('#tokOut'); if (to) to.onclick = () => { localStorage.removeItem(LS.token); render(); };
}

// ---------------------------------------------------------------- Depot-Dialog
function renderDepot(focusId) {
  const dlg = document.getElementById('depot');
  const items = orderedItems().filter(it => !isIndex(it.id));
  const sel = focusId || dlg.dataset.id || items[0]?.id;
  dlg.dataset.id = sel;
  const m = meta(sel), lots = lotsOf(sel), hold = holding(sel);
  let h = `<h2>Depot</h2><p class="sub">Nur auf diesem Gerät gespeichert (localStorage) – wird nie hochgeladen. Mit Export/Import auf andere Geräte übertragen.</p>
    <div class="row"><select id="dSel">${items.map(it => `<option value="${esc(it.id)}" ${it.id === sel ? 'selected' : ''}>${esc(itemName(it))} (${esc(meta(it.id).currency || '')})${lotsOf(it.id).length ? ' ●' : ''}</option>`).join('')}</select>
    ${hold ? `<span class="sub">Anzahl ${nf0.format(hold.qty)} · Ø Kaufpreis ${p2(hold.avg)} ${esc(m.currency || '')} · Wert ${p2(hold.value)} CHF · ${sgn(hold.gain)} CHF (${pct(hold.gainPct)})</span>` : ''}</div>
    <table class="lots"><thead><tr><th>Kaufdatum</th><th class="n">Anzahl</th><th class="n">Kaufpreis (${esc(m.currency || '')})</th><th class="n">Devisenkurs CHF</th><th class="n">Einstand CHF</th><th></th></tr></thead><tbody>`;
  const [base, unit] = ccyInfo(m.currency);
  lots.forEach((l, i) => {
    h += `<tr><td><input type="date" data-f="date" data-i="${i}" value="${esc(l.date)}"></td><td class="n"><input type="number" step="any" min="0" data-f="qty" data-i="${i}" value="${l.qty}"></td>
      <td class="n"><input type="number" step="any" min="0" data-f="price" data-i="${i}" value="${l.price}"></td><td class="n">${base === 'CHF' ? '1' : p4(l.fx)}</td>
      <td class="n">${l.fx != null || base === 'CHF' ? p2(l.qty * l.price * unit * (base === 'CHF' ? 1 : l.fx)) : '–'}</td><td><button class="danger" data-rm="${i}">Löschen</button></td></tr>`;
  });
  h += `<tr><td><input type="date" id="nDate" value="${zurichToday()}"></td><td class="n"><input type="number" step="any" min="0" id="nQty" placeholder="Anzahl"></td>
    <td class="n"><input type="number" step="any" min="0" id="nPrice" placeholder="Preis"></td><td></td><td></td><td><button id="nAdd">Hinzufügen</button></td></tr></tbody></table>
    <p class="small">Devisenkurs am Kaufdatum: EZB-Referenzkurs via Frankfurter (letzter verfügbarer Kurs vor dem Datum).</p>
    <div class="row"><button id="dExp">Export (JSON)</button><label class="chk"><button id="dImpBtn">Import (JSON)</button><input type="file" id="dImp" accept="application/json,.json" hidden></label><span style="flex:1"></span><button id="dClose">Schliessen</button></div>
    <p id="dMsg" class="small"></p>`;
  dlg.innerHTML = h;
  const msg = t => { dlg.querySelector('#dMsg').textContent = t; };
  dlg.querySelector('#dSel').onchange = e => renderDepot(e.target.value);
  dlg.querySelector('#dClose').onclick = () => dlg.close();
  dlg.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (!confirm('Kauf löschen?')) return; lots.splice(+b.dataset.rm, 1); if (!lots.length) delete portfolio.lots[sel]; savePortfolio(); renderDepot(sel); render(); });
  dlg.querySelectorAll('[data-f]').forEach(inp => inp.onchange = async () => {
    const l = lots[+inp.dataset.i]; const f = inp.dataset.f;
    l[f] = f === 'date' ? inp.value : +inp.value;
    if (f === 'date') { l.fx = null; try { l.fx = await fxOnDate(base, l.date); } catch (e) { msg(`Devisenkurs nicht verfügbar: ${e.message}`); } }
    savePortfolio(); renderDepot(sel); render();
  });
  dlg.querySelector('#nAdd').onclick = async () => {
    const date = dlg.querySelector('#nDate').value, qty = +dlg.querySelector('#nQty').value, price = +dlg.querySelector('#nPrice').value;
    if (!date || !(qty > 0) || !(price > 0)) return msg('Bitte Datum, Anzahl und Kaufpreis eingeben.');
    let fx = null; try { fx = await fxOnDate(base, date); } catch (e) { msg(`Devisenkurs nicht verfügbar (${e.message}) – wird später nachgetragen.`); }
    (portfolio.lots[sel] ||= []).push({ id: crypto.randomUUID(), date, qty, price, fx });
    portfolio.lots[sel].sort((a, b) => a.date.localeCompare(b.date));
    savePortfolio(); renderDepot(sel); render();
  };
  dlg.querySelector('#dExp').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(portfolio, null, 1)], { type: 'application/json' }));
    a.download = `Aktienuebersicht-Depot_${zurichToday()}.json`; a.click();
  };
  dlg.querySelector('#dImpBtn').onclick = () => dlg.querySelector('#dImp').click();
  dlg.querySelector('#dImp').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!j || typeof j.lots !== 'object') throw new Error('kein Depot-Format');
      if (!confirm('Depot auf diesem Gerät durch die importierte Datei ersetzen?')) return;
      portfolio = { version: 1, lots: j.lots }; savePortfolio(); renderDepot(); render(); msg('Importiert.');
    } catch (err) { msg(`Import fehlgeschlagen: ${err.message}`); }
  };
}
async function fillMissingFx() {
  let changed = false;
  for (const [id, lots] of Object.entries(portfolio.lots)) {
    const [base] = ccyInfo(meta(id).currency);
    for (const l of lots) if (l.fx == null && base !== 'CHF' && meta(id).currency) { try { l.fx = await fxOnDate(base, l.date); changed = true; } catch { /* später */ } }
  }
  if (changed) { savePortfolio(); render(); }
}

// ---------------------------------------------------------------- CSV
function csv() {
  const today = zurichToday();
  const days = weekdayKeys(START, today < START ? START : today);
  const num = v => (v == null ? '' : String(+v.toFixed(6)));
  const lines = [['Titel', 'Symbol', 'Währung', 'Zeile', ...days.map(dmy)].join(';')];
  for (const it of orderedItems()) {
    const id = it.id, L = [itemName(it).replace(/;/g, ','), id, ccyLabel(id)];
    HOURS.forEach((hr, i) => {
      lines.push([...L, `${pad(hr)}:00`, ...days.map(k => num(val(id, k, hr)))].join(';'));
      if (i === 0) for (const f of FC) {
        lines.push([...L, `${f.label} (${DISCLAIMER})`, ...days.map(k => num(fcOf(id, k, f.k)))].join(';'));
        lines.push([...L, `Abweichung ${f.short} Ist − Prognose`, ...days.map(k => { const v = fcOf(id, k, f.k), a = actualOf(id, k, f.k); return v != null && a ? num(a.v - v) : ''; })].join(';'));
      }
    });
    lines.push([...L, 'Schlusskurs', ...days.map(k => num(closeOf(id, k)))].join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- Start
function showLogin(msg) {
  document.getElementById('app').hidden = true; document.getElementById('login').hidden = false;
  const e = document.getElementById('loginErr'); e.hidden = !msg; e.textContent = msg || '';
  document.getElementById('pw').value = ''; document.getElementById('pw').focus();
}
function showApp() { document.getElementById('login').hidden = true; document.getElementById('app').hidden = false; }
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = 'Prüfe …';
  try { await unlock(document.getElementById('pw').value, document.getElementById('remember').checked); document.getElementById('pw').value = ''; showApp(); await load(); fillMissingFx(); }
  catch (err) { const el = document.getElementById('loginErr'); el.hidden = false; el.textContent = err.message === 'Falsches Passwort.' ? 'Falsches Passwort.' : `Fehler: ${err.message}`; }
  finally { btn.disabled = false; btn.textContent = 'Entsperren'; }
});
document.getElementById('reload').addEventListener('click', load);
document.getElementById('logout').addEventListener('click', e => { e.preventDefault(); logout(); });
document.getElementById('sort').addEventListener('change', e => { prefs.sort = e.target.value; savePrefs(); render(); });
document.getElementById('showFc').addEventListener('change', e => { prefs.showFc = e.target.checked; savePrefs(); render(); });
document.getElementById('newsFilter').addEventListener('change', e => { prefs.newsFilter = e.target.value; savePrefs(); renderNews(); });
document.getElementById('newsGroup').addEventListener('change', e => { prefs.newsGroup = e.target.checked; savePrefs(); renderNews(); });
document.getElementById('editBtn').addEventListener('click', () => { editing = !editing; searchResults = []; renderEditor(); });
document.getElementById('depotBtn').addEventListener('click', () => { renderDepot(); document.getElementById('depot').showModal(); });
document.getElementById('csv').addEventListener('click', e => {
  e.preventDefault();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv;charset=utf-8' }));
  a.download = `Aktienuebersicht_${zurichToday()}.csv`; a.click();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && cryptoKey) load(); });
setInterval(() => { if (cryptoKey) load(); }, 10 * 60 * 1000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (await restoreKey()) { showApp(); await loadCache(); await load(); fillMissingFx(); }
  else showLogin();
})();
