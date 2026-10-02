'use strict';
// Aktienübersicht – Web-App (Layout nach Apple „Aktien“: Liste links, Detail rechts, Übersicht als Tabelle).
// Liest die verschlüsselten Dateien unter data/ (AES-256-GCM, PBKDF2-SHA256) und entschlüsselt im Browser (WebCrypto).
// Depot nur lokal (localStorage), wird nie übertragen.
const REPO = 'BigYok61/aktienuebersicht';
const FILES = { watch: 'data/watchlist.enc.json', quotes: 'data/quotes.enc.json', news: 'data/news.enc.json', charts: 'data/charts.enc.json', alerts: 'data/alerts.enc.json' };
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
const RANGES = ['1T', '1W', '1M', '3M', '6M', 'YTD', '1J', '2J', '5J', 'ALLE'];
const RANGE_LABEL = { '1T': '1 T.', '1W': '1 W.', '1M': '1 M.', '3M': '3 M.', '6M': '6 M.', YTD: 'YTD', '1J': '1 J.', '2J': '2 J.', '5J': '5 J.', ALLE: 'ALLE' };
const SPARKS = { '1T': '1 T.', '5T': '5 T.', '1M': '1 M.', '1J': '1 J.' };
const LS = { key: 'au.key', token: 'au.ghToken', prefs: 'au.prefs', portfolio: 'au.portfolio', cache: 'au.cache', hist: 'au.depotHist' };
const INDEXES = [
  ['SIX:SMI', 'SMI', '.SSMI'], ['SIX:SLI', 'SLI', '.SLI'], ['SP:SPX', 'S&P 500', '.SPX'], ['NASDAQ:NDX', 'Nasdaq 100', '.NDX'],
  ['NASDAQ:IXIC', 'Nasdaq Composite', '.IXIC'], ['DJ:DJI', 'Dow Jones', '.DJI'], ['XETR:DAX', 'DAX', '.GDAXI'],
  ['TVC:SX5E', 'Euro Stoxx 50', '.STOXX50E'], ['FTSE:UKX', 'FTSE 100', '.FTSE'], ['TVC:NI225', 'Nikkei 225', '.N225'],
];
const EXCH_PREF = ['SIX', 'XETR', 'NASDAQ', 'NYSE', 'AMEX', 'EURONEXT', 'LSE', 'BME', 'MIL', 'VIE', 'TSX', 'OTC'];
const EXCH_NAME = { SIX: 'Schweiz', XETR: 'Xetra', NASDAQ: 'Nasdaq', NYSE: 'NYSE', AMEX: 'NYSE American', OTC: 'OTC', LSE: 'London', DJ: 'Dow Jones', SP: 'S&P', FTSE: 'FTSE', TVC: 'Index' };

// ---------------------------------------------------------------- Formatierung
const nf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf4 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 4 });
const nfi = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const ok = v => v != null && isFinite(v);
const p2 = v => (!ok(v) ? '–' : nf2.format(v));
const p4 = v => (!ok(v) ? '–' : nf4.format(v));
const z2 = v => (Math.abs(v) < 0.005 ? 0 : v); // kein «-0.00»
const pct = v => (!ok(v) ? '–' : (z2(v) > 0 ? '+' : '') + nf2.format(z2(v)) + ' %');
const sgn = v => (!ok(v) ? '–' : (z2(v) > 0 ? '+' : '') + nf2.format(z2(v)));
const big = v => (!ok(v) ? '–' : Math.abs(v) >= 1e12 ? nf2.format(v / 1e12) + ' Bio.' : Math.abs(v) >= 1e9 ? nf2.format(v / 1e9) + ' Mrd.' : Math.abs(v) >= 1e6 ? nf2.format(v / 1e6) + ' Mio.' : nfi.format(v));
const pad = h => String(h).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const $ = id => document.getElementById(id);
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
const wdFmt = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });
const monFmt = new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', month: 'short' });
const monYFmt = new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', month: 'short', year: '2-digit' });
function ageText(t) {
  const m = Math.max(0, (Date.now() - new Date(t)) / 60000);
  if (m < 60) return `Vor ${Math.round(m)} Min.`;
  if (m < 24 * 60) return `Vor ${Math.round(m / 60)} Std.`;
  return `Vor ${Math.round(m / 1440)} Tg.`;
}
const ymd8 = n => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

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
  let pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, cryptoKey, b64d(blob.ct));
  if (blob.z === 'deflate-raw') pt = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
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
  watch = { items: [], categories: [] }; quotes = { days: {}, symbols: {} }; news = { articles: [] }; charts = { s: {} }; alerts = { alerts: [] };
  showLogin('Abgemeldet.');
}

// ---------------------------------------------------------------- Zustand
let watch = { items: [], categories: [] }, quotes = { days: {}, symbols: {} }, news = { articles: [] }, charts = { s: {} }, alerts = { alerts: [] };
let live = { q: {}, fx: {}, time: null, ok: false };
let selected = null; // null = Übersicht
let range = '1T';
let searchQ = '';
const prefs = Object.assign({ sort: 'cat', order: [], showFc: true, newsFilter: '', heute: 'pct', spark: '1T', range: '1T', sel: '' },
  JSON.parse(localStorage.getItem(LS.prefs) || '{}'));
const savePrefs = () => localStorage.setItem(LS.prefs, JSON.stringify(prefs));
let portfolio = loadPortfolio();
function loadPortfolio() { try { return Object.assign({ version: 1, lots: {} }, JSON.parse(localStorage.getItem(LS.portfolio) || '{}')); } catch { return { version: 1, lots: {} }; } }
function savePortfolio() { portfolio.updated = new Date().toISOString(); localStorage.setItem(LS.portfolio, JSON.stringify(portfolio)); }

const meta = id => quotes.symbols?.[id] || {};
const stats = id => meta(id).stats || {};
const itemOf = id => (watch.items || []).find(i => i.id === id) || { id };
const itemName = it => it.name || meta(it.id).name || it.id;
const ticker = id => id.split(':').pop();
const symOf = id => itemOf(id).symbol || ticker(id);
const isIndex = id => meta(id).type === 'index' || INDEXES.some(x => x[0] === id);
function ccyInfo(c) { if (c === 'GBX' || c === 'GBp') return ['GBP', 0.01]; if (c === 'ILA') return ['ILS', 0.01]; if (c === 'ZAC') return ['ZAR', 0.01]; return [c || 'CHF', 1]; }
const ccyLabel = id => (isIndex(id) ? 'Punkte' : (meta(id).currency || ''));
const val = (id, k, h) => quotes.days?.[k]?.slots?.[pad(h)]?.[id] ?? null;
const fxAt = (ccy, k, h) => (ccy === 'CHF' ? 1 : quotes.days?.[k]?.fx?.[pad(h)]?.[ccy] ?? null);
const closeOf = (id, k) => quotes.days?.[k]?.close?.[id] ?? null;
const prevOf = (id, k) => quotes.days?.[k]?.prev?.[id] ?? null;
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
/** Aktueller Kurs: live (TradingView), sonst letzter erfasster Wert (gekennzeichnet). Überschreibt nie die Zeitpunkt-Werte. */
function nowPrice(id) {
  const l = live.q[id];
  if (l && l.close != null) return { v: l.close, live: true, time: live.time };
  const r = latestRecorded(id);
  const c = charts.s?.[id]?.i; const lastBar = c && c.length ? c[c.length - 1] : null;
  if (lastBar) return { v: lastBar[1], live: false, chart: true, time: new Date(lastBar[0] * 60000) };
  return r ? { v: r.v, live: false, k: r.k, h: r.h } : null;
}
function nowFx(ccy) {
  if (ccy === 'CHF') return { v: 1, live: true };
  if (live.fx[ccy] != null) return { v: live.fx[ccy], live: true };
  const r = latestFx(ccy); return r ? { ...r, live: false } : null;
}
/** Tagesveränderung gegenüber Vortagesschluss */
function dayChange(id) {
  const l = live.q[id];
  if (l && l.change != null) return { pct: l.change, abs: l.change_abs, price: l.close, live: true };
  const p = nowPrice(id); const today = zurichToday();
  const prev = prevOf(id, today) ?? charts.s?.[id]?.pc;
  if (p && prev) return { pct: (p.v / prev - 1) * 100, abs: p.v - prev, price: p.v, live: false };
  const st = stats(id);
  if (st.change != null) return { pct: st.change, abs: st.changeAbs, price: p?.v, live: false };
  return null;
}
const chgCls = v => (!ok(v) ? 'flat' : v > 1 ? 'up' : v < -1 ? 'down' : 'flat'); // Farbregel ±1 %
const lineCls = v => (!ok(v) ? 'flat' : v >= 0 ? 'up' : 'down');

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
  const dc = dayChange(id);
  return { qty, avg, costChf: costChfOk ? costChf : null, value, gain: value != null && costChfOk ? value - costChf : null,
    gainPct: value != null && costChfOk && costChf ? (value / costChf - 1) * 100 : null, live: p?.live && fx?.live,
    dayChf: dc && fx && dc.abs != null ? qty * dc.abs * unit * fx.v : null };
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
  if (prefs.sort === 'alpha') return items.sort((a, b) => symOf(a.id).localeCompare(symOf(b.id), 'de-CH'));
  if (prefs.sort === 'name') return items.sort((a, b) => itemName(a).localeCompare(itemName(b), 'de-CH'));
  if (prefs.sort === 'chg') return items.sort((a, b) => (dayChange(b.id)?.pct ?? -1e9) - (dayChange(a.id)?.pct ?? -1e9));
  if (prefs.sort === 'manual') {
    if (canEdit() || !prefs.order.length) return items;
    const pos = id => { const i = prefs.order.indexOf(id); return i < 0 ? 1e6 : i; };
    return items.map((it, i) => [it, i]).sort((a, b) => (pos(a[0].id) - pos(b[0].id)) || (a[1] - b[1])).map(x => x[0]);
  }
  const cats = [...(watch.categories || [])];
  for (const it of items) if (!cats.includes(catOf(it))) cats.push(catOf(it));
  return items.map((it, i) => [it, i]).sort((a, b) => (cats.indexOf(catOf(a[0])) - cats.indexOf(catOf(b[0]))) || (a[1] - b[1])).map(x => x[0]);
}
function categoryChoices() {
  const s = [...(watch.categories || [])];
  for (const it of watch.items || []) if (!s.includes(catOf(it))) s.push(catOf(it));
  for (const d of ['Indizes', 'Tech', 'Auto', 'Pharma', 'Banken/Finanz', 'Konsum', 'Industrie', 'Telekom']) if (!s.includes(d)) s.push(d);
  return s;
}
function categoryFor(sector, industry, type) { // identisch mit capture.py / Swift
  const s = (sector || '').toLowerCase(), i = (industry || '').toLowerCase();
  if (type === 'index') return 'Indizes';
  if (i.includes('motor vehicle') || i.includes('auto')) return 'Auto';
  if (['electronic technology', 'technology services'].includes(s)) return 'Tech';
  if (['health technology', 'health services'].includes(s)) return 'Pharma';
  if (s === 'finance') return 'Banken/Finanz';
  if (['consumer non-durables', 'consumer durables', 'retail trade', 'consumer services'].includes(s)) return 'Konsum';
  if (['producer manufacturing', 'industrial services', 'process industries', 'non-energy minerals', 'transportation', 'commercial services'].includes(s)) return 'Industrie';
  if (['energy minerals', 'utilities'].includes(s)) return 'Energie';
  if (s === 'communications') return 'Telekom';
  return 'Sonstige';
}

// ---------------------------------------------------------------- Dividende / Kursziel / Termine
function divInfo(id) {
  const d = quotes.dividends?.[id]; const ccy = meta(id).currency || '';
  if (isIndex(id)) return null;
  if (!d || d.status === 'unknown') return { text: 'unbekannt', tip: 'Keine Dividendendaten' };
  if (d.status === 'none') return { text: 'keine', tip: 'Keine Dividende' };
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
  const p = nowPrice(id); const y = d.annual && p ? d.annual / p.v * 100 : d.yield;
  return { text: `${p2(d.annual)} ${ccy} · ${ok(y) ? nf2.format(y) + ' %' : '–'}`, tip: tip.join('\n'), next: d.nextEx, yield: y, est: d.nextEstimated };
}
function divHtml(id) {
  const d = divInfo(id); if (!d) return '';
  return `<span class="hint" title="${esc(d.tip)}"><span class="k">Dividende</span> ${esc(d.text)}${d.next ? ` <span class="cal" title="${esc(d.tip)}">📅</span>` : ''}</span>`;
}
function targetInfo(id) {
  if (isIndex(id)) return null;
  const t = quotes.targets?.[id];
  if (!t || t.mean == null) return { text: 'keine Daten', tip: '' };
  const p = nowPrice(id); const up = p ? (t.mean / p.v - 1) * 100 : null;
  const tip = [`Konsens-Kursziel (Mittelwert) 12 Monate: ${p2(t.mean)} ${t.currency || ''}`,
    t.median != null ? `Median: ${p2(t.median)}` : null,
    t.low != null && t.high != null ? `Spanne: ${p2(t.low)} – ${p2(t.high)}` : null,
    t.count ? `Analysten: ${t.count}` : null,
    p ? `Potenzial gegenüber ${p.live ? 'aktuellem' : 'letztem erfassten'} Kurs ${p2(p.v)}: ${pct(up)}` : null,
    `Quelle: ${t.source}, Stand ${dmy(t.asOf)}`, 'Keine Anlageberatung'].filter(Boolean);
  return { mean: t.mean, up, text: `${p2(t.mean)} ${t.currency || ''}`, tip: tip.join('\n'), t };
}
function targetHtml(id) {
  const t = targetInfo(id); if (!t) return '';
  if (t.mean == null) return '<span class="k">Kursziel</span> keine Daten';
  return `<span class="hint" title="${esc(t.tip)}"><span class="k">Kursziel</span> ${p2(t.mean)} <span class="${chgCls(t.up)}t">(${pct(t.up)})</span></span>`;
}
function earningsHtml(id) {
  const e = stats(id).earningsNext; if (!e || isIndex(id)) return '';
  return `<span class="hint" title="Nächste Quartalszahlen: ${esc(dmy(e))}${stats(id).earningsLast ? '\nLetzte: ' + esc(dmy(stats(id).earningsLast)) : ''}"><span class="k">Zahlen</span> <span class="cal">📅</span> ${esc(dmyShort(e))}</span>`;
}
function w52Html(id) {
  const s = stats(id); if (s.h52 == null) return '';
  const p = nowPrice(id); const dist = p ? (p.v / s.h52 - 1) * 100 : null;
  return `<span class="hint" title="52-Wochen-Hoch ${p2(s.h52)} · Tief ${p2(s.l52)}\nAbstand vom 52W-Hoch: ${pct(dist)}"><span class="k">52W</span> ${p2(s.l52)} – ${p2(s.h52)} <span class="${dist < -20 ? 'down' : 'flat'}t">(${pct(dist)})</span></span>`;
}

// ---------------------------------------------------------------- Chartdaten
/** Serie [{t: ms, v, vol}] für einen Bereich */
function series(id, r) {
  const c = charts.s?.[id]; if (!c) return { pts: [], prev: null, intraday: false };
  const toPts = arr => arr.map(x => ({ t: x[0] * 60000, v: x[1], vol: x[2] || 0 }));
  const dPts = arr => arr.map(x => ({ t: Date.parse(ymd8(x[0]) + 'T12:00:00Z'), v: x[1], vol: x[2] || 0 }));
  if (r === '1T' || r === '5T' || r === '1W') {
    const i = c.i || [];
    let n = c.i1n;
    if (n == null) { // älterer Stand ohne i1n: letzter Block nach einer Lücke > 3 Std.
      n = 1; for (let k = i.length - 1; k > 0; k--) { if (i[k][0] - i[k - 1][0] > 180) break; n++; }
    }
    let pts = toPts(r === '1T' ? i.slice(i.length - n) : i);
    const l = live.q[id];
    if (r === '1T' && l && l.close != null && l.update_time && pts.length && l.update_time * 1000 > pts[pts.length - 1].t + 60000
      && l.update_time * 1000 - pts[pts.length - 1].t < 4 * 3600000) pts = [...pts, { t: l.update_time * 1000, v: l.close, vol: 0 }];
    return { pts, prev: r === '1T' ? c.pc : null, intraday: true };
  }
  if (r === 'ALLE') return { pts: dPts(c.a || []), prev: null, intraday: false };
  const d = c.d || []; const last = d.length ? ymd8(d[d.length - 1][0]) : zurichToday();
  if (r === '5J') { const from = addMonths(last, -60).replace(/-/g, ''); return { pts: dPts((c.w || []).filter(x => String(x[0]) >= from)), prev: null, intraday: false }; }
  const from = r === 'YTD' ? last.slice(0, 4) + '-01-01' : addMonths(last, -({ '1M': 1, '3M': 3, '6M': 6, '1J': 12, '2J': 24 }[r]));
  const f8 = +from.replace(/-/g, '');
  return { pts: dPts(d.filter(x => x[0] >= f8)), prev: null, intraday: false };
}
function sparkSvg(id, w = 64, h = 26) {
  const r = prefs.spark === '5T' ? '1W' : prefs.spark;
  const { pts, prev } = series(id, r);
  if (pts.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const vs = pts.map(p => p.v); const base = prev ?? vs[0];
  let lo = Math.min(...vs, base), hi = Math.max(...vs, base); if (hi === lo) { hi += 1; lo -= 1; }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = t => ((t - t0) / (t1 - t0 || 1)) * (w - 2) + 1, Y = v => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const cls = lineCls(vs[vs.length - 1] - base);
  return `<svg class="spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="fill" d="${line}L${X(t1).toFixed(1)},${h}L1,${h}Z"/><path class="ln" d="${line}"/><line class="base" x1="0" x2="${w}" y1="${Y(base).toFixed(1)}" y2="${Y(base).toFixed(1)}"/></svg>`;
}
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1; const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function bigChartSvg(id, r) {
  const { pts, prev, intraday } = series(id, r);
  const W = 720, H = 300, VH = 40, PR = 64, PB = 22;
  if (pts.length < 2) return `<div class="nochart">Für diesen Zeitraum liegen keine Chartdaten vor.</div>`;
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs, prev ?? Infinity), hi = Math.max(...vs, prev ?? -Infinity);
  const padv = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; lo -= padv; hi += padv;
  const cw = W - PR, ch = H - PB - VH - 6;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  // Intraday: Index statt Zeit (keine Lücken über Nacht), sonst Zeitachse
  const useIdx = intraday;
  const X = (p, i) => (useIdx ? (i / (pts.length - 1)) : ((p.t - t0) / (t1 - t0 || 1))) * (cw - 4) + 2;
  const Y = v => 4 + (1 - (v - lo) / (hi - lo)) * (ch - 8);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p, i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const first = prev ?? vs[0]; const cls = lineCls(vs[vs.length - 1] - first);
  let g = `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-id="${esc(id)}">`;
  g += `<defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>`;
  for (const tv of niceTicks(lo, hi)) { const y = Y(tv); g += `<line class="grid" x1="0" x2="${cw}" y1="${y}" y2="${y}"/><text class="yl" x="${cw + 6}" y="${y + 4}">${p2(tv)}</text>`; }
  // X-Beschriftung
  const xl = []; let lastKey = null;
  pts.forEach((p, i) => {
    const d = new Date(p.t);
    let key, lab;
    if (r === '1T') { key = hmFmt.format(d).slice(0, 2); lab = key; }
    else if (r === '1W' || r === '5T') { key = wdFmt.format(d); lab = key.split(',')[0]; }
    else if (r === '1M') { key = Math.floor((p.t - t0) / (7 * 864e5)); lab = `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; }
    else if (r === '3M' || r === '6M' || r === 'YTD' || r === '1J') { key = d.getUTCMonth(); lab = monFmt.format(d); }
    else { key = r === 'ALLE' ? Math.floor(d.getUTCFullYear() / 5) : d.getUTCFullYear(); lab = String(d.getUTCFullYear()); }
    if (key !== lastKey) { if (lastKey !== null) xl.push([X(p, i), lab]); lastKey = key; }
  });
  const minGap = 46; let lx = -1e9;
  for (const [x, lab] of xl) { if (x - lx < minGap) continue; lx = x; g += `<line class="grid v" x1="${x}" x2="${x}" y1="0" y2="${H - PB}"/><text class="xl" x="${x + 3}" y="${H - 6}">${esc(lab)}</text>`; }
  g += `<path class="area" d="${line}L${X(pts[pts.length - 1], pts.length - 1).toFixed(1)},${ch}L${X(pts[0], 0).toFixed(1)},${ch}Z" fill="url(#gf)"/><path class="ln" d="${line}"/>`;
  if (prev != null) g += `<line class="prev" x1="0" x2="${cw}" y1="${Y(prev)}" y2="${Y(prev)}"><title>Vortagesschluss ${p2(prev)}</title></line>`;
  // Volumen
  const vmax = Math.max(...pts.map(p => p.vol || 0));
  if (vmax > 0) {
    const bw = Math.max(1, (cw - 4) / pts.length - 0.6); const y0 = H - PB - 2;
    let vb = '';
    pts.forEach((p, i) => { if (!p.vol) return; const hh = (p.vol / vmax) * VH; vb += `M${(X(p, i) - bw / 2).toFixed(1)},${y0}v${(-hh).toFixed(1)}h${bw.toFixed(1)}v${hh.toFixed(1)}Z`; });
    g += `<path class="vol" d="${vb}"/>`;
  }
  g += `<line class="cross" x1="0" x2="0" y1="0" y2="${H - PB}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>`;
  g += `<rect class="hit" x="0" y="0" width="${cw}" height="${H}" fill="transparent"/></svg>`;
  chartState = { pts, X, Y, cw, useIdx, r, id };
  return g;
}
let chartState = null;
function wireChart() {
  const svg = document.querySelector('#detail svg.chart'); if (!svg || !chartState) return;
  const tip = $('chartTip'); const { pts, X, Y, cw, r } = chartState;
  const move = ev => {
    const rect = svg.getBoundingClientRect(); const sx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const x = sx * (720 / rect.width); if (x > cw) return;
    let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.abs(X(p, i) - x); if (d < bd) { bd = d; bi = i; } });
    const p = pts[bi]; const px = X(p, bi), py = Y(p.v);
    const cr = svg.querySelector('.cross'), dt = svg.querySelector('.dot');
    cr.setAttribute('x1', px); cr.setAttribute('x2', px); cr.setAttribute('visibility', 'visible');
    dt.setAttribute('cx', px); dt.setAttribute('cy', py); dt.setAttribute('visibility', 'visible');
    const d = new Date(p.t);
    tip.hidden = false;
    tip.textContent = `${r === '1T' || r === '1W' ? timeFmt.format(d) : dmy(d.toISOString().slice(0, 10))} · ${p2(p.v)}${p.vol ? ' · Vol. ' + big(p.vol) : ''}`;
    tip.style.left = `${Math.min(rect.width - 180, Math.max(0, px * rect.width / 720 - 60))}px`;
  };
  const leave = () => { tip.hidden = true; svg.querySelector('.cross').setAttribute('visibility', 'hidden'); svg.querySelector('.dot').setAttribute('visibility', 'hidden'); };
  svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
}

// ---------------------------------------------------------------- Seitenleiste
/** Zusatzspalten in der Liste neben dem Kurs (Platzhalter, noch nicht festgelegt): { cls, html: id => '…' } */
const LIST_COLS = [];
function pill(id) {
  const c = dayChange(id);
  const txt = !c ? '–' : prefs.pill === 'abs' ? sgn(c.abs) : pct(c.pct);
  return `<span class="pill ${chgCls(c?.pct)}" title="Veränderung gegenüber Vortagesschluss${c && !c.live ? ' (letzter erfasster Stand)' : ''}\nGrün > +1 %, Rot < −1 %">${txt}</span>`;
}
function renderSidebar() {
  const list = $('list');
  const q = searchQ.trim().toLowerCase();
  const items = orderedItems().filter(it => !q || symOf(it.id).toLowerCase().includes(q) || itemName(it).toLowerCase().includes(q) || it.id.toLowerCase().includes(q));
  let h = '';
  let lastCat = null;
  const drag = prefs.sort === 'manual' && !q;
  for (const it of items) {
    if (prefs.sort === 'cat' && catOf(it) !== lastCat) { lastCat = catOf(it); h += `<li class="cat">${esc(lastCat)}</li>`; }
    const p = nowPrice(it.id);
    h += `<li class="st${selected === it.id ? ' sel' : ''}" data-id="${esc(it.id)}" data-pop="${esc(it.id)}"${drag ? ' draggable="true"' : ''}>
      <div class="nm"><b>${esc(symOf(it.id))}</b><small>${esc(itemName(it))}</small></div>
      ${sparkSvg(it.id, 44, 20)}${LIST_COLS.map(c => `<div class="xc ${c.cls || ''}">${c.html(it.id)}</div>`).join('')}
      <div class="px"><span class="v">${p ? p2(p.v) : '–'}</span>${pill(it.id).replace(/ title="[^"]*"/, '')}</div>${infoBtn(it.id)}</li>`;
  }
  if (!items.length) h += `<li class="empty">${q ? 'Kein Treffer in der Watchlist.' : 'Watchlist leer'}</li>`;
  list.innerHTML = h;
  list.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => select(li.dataset.id));
  $('sort').value = prefs.sort; $('sparkSel').value = prefs.spark;
  popRefresh();
  if (drag) {
    let dragId = null;
    list.querySelectorAll('li[draggable]').forEach(li => {
      li.ondragstart = e => { dragId = li.dataset.id; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; };
      li.ondragend = () => li.classList.remove('drag');
      li.ondragover = e => { e.preventDefault(); li.classList.add('over'); };
      li.ondragleave = () => li.classList.remove('over');
      li.ondrop = e => {
        e.preventDefault(); li.classList.remove('over'); if (!dragId || dragId === li.dataset.id) return;
        const ids = orderedItems().map(i => i.id).filter(x => x !== dragId); ids.splice(ids.indexOf(li.dataset.id), 0, dragId); moveTo(ids);
      };
    });
  }
}
function select(id) {
  popHide();
  selected = id; prefs.sel = id; savePrefs();
  document.body.classList.add('show-main');
  render();
  $('main').scrollTop = 0; if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- Detail
function statCell(k, v, tip = '') { return `<div class="sc"${tip ? ` title="${esc(tip)}"` : ''}><span>${k}</span><b>${v}</b></div>`; }
function renderDetail(id) {
  const it = itemOf(id), m = meta(id), s = stats(id), c = dayChange(id), p = nowPrice(id), idx = isIndex(id);
  const today = zurichToday();
  const ex = EXCH_NAME[m.exchange] || m.exchange || id.split(':')[0];
  const ccy = idx ? 'Punkte' : (m.currency || '');
  let h = `<div class="dhead"><button class="back" id="back">‹ Liste</button>
    <div class="dtitle"><h1>${esc(symOf(id))}</h1><span class="dname">${esc(m.longName || itemName(it))}</span><div class="dsub">${esc(ex)} · ${esc(ccy)} · ${esc(catOf(it))}</div></div>
    <div class="dprice"><b>${p ? p2(p.v) : '–'}</b> <span class="${chgCls(c?.pct)}t">${c ? `${sgn(c.abs)} (${pct(c.pct)})` : ''}</span>
    <div class="dsub">${p?.live ? 'Jetzt ' + hmFmt.format(p.time) + ' (bis 15 Min. verzögert)' : p?.time ? 'Stand ' + timeFmt.format(p.time) : p ? `Erfasst ${header(p.k)} ${pad(p.h)}:00` : ''}</div></div></div>`;
  h += `<div class="tabs" id="tabs">${RANGES.map(r => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${RANGE_LABEL[r]}</button>`).join('')}</div>`;
  h += `<div class="chartwrap">${bigChartSvg(id, range)}<div id="chartTip" class="ctip" hidden></div></div>`;
  const l = live.q[id] || {};
  const pick = (a, b) => (a != null ? a : b);
  const dv = divInfo(id);
  h += `<div class="stats">
    ${statCell('Eröffn.', p2(pick(l.open, s.open)))}${statCell('Vol.', big(pick(l.volume, s.volume)))}${statCell('52W-H', p2(s.h52))}${statCell('Rendite', dv && ok(dv.yield) ? nf2.format(dv.yield) + ' %' : ok(s.divYield) ? nf2.format(s.divYield) + ' %' : '–')}
    ${statCell('Hoch', p2(pick(l.high, s.high)))}${statCell('KGV', p2(s.pe))}${statCell('52W-T', p2(s.l52))}${statCell('Beta', p2(s.beta))}
    ${statCell('Tief', p2(pick(l.low, s.low)))}${statCell('Marktkap.', idx ? '–' : big(s.mcap) + (s.mcapCcy && s.mcap ? ' ' + s.mcapCcy : ''), s.mcapChf ? 'ca. ' + big(s.mcapChf) + ' CHF' : '')}${statCell('Ø-Vol.', big(s.avgVol), 'Durchschnitt 30 Tage')}${statCell('EPS', p2(s.eps), 'Gewinn je Aktie (12 Monate), Handelswährung')}
  </div>`;
  // Extras
  let fcRows = '';
  for (const f of FC) {
    // jüngste Prognose mit Ist-Wert und jüngste Prognose überhaupt
    const ks = Object.keys(quotes.days || {}).filter(k => fcOf(id, k, f.k) != null).sort();
    const kLast = ks[ks.length - 1];
    const kDone = [...ks].reverse().find(k => actualOf(id, k, f.k));
    const v = kLast ? fcOf(id, kLast, f.k) : null; const b = kLast ? val(id, kLast, HOURS[0]) : null;
    let ist = '–';
    if (kDone) { const a = actualOf(id, kDone, f.k), pv = fcOf(id, kDone, f.k); ist = `<span title="Prognose vom ${dmy(kDone)}: ${p2(pv)} · Ist ${dmy(a.day)}: ${p2(a.v)}">${p2(a.v)} <span class="${chgCls((a.v / pv - 1) * 100)}t">(${pct((a.v / pv - 1) * 100)})</span></span>`; }
    else if (kLast) ist = `<span class="sub">ab ${dmyShort(targetOf(kLast, f.k))}</span>`;
    fcRows += `<tr title="${DISCLAIMER}"><th>${f.short}</th><td>${v != null ? p2(v) : '–'}${v != null && b ? ` <small class="${lineCls(v - b)}t">${pct((v / b - 1) * 100)}</small>` : ''}</td><td>${kLast ? dmyShort(targetOf(kLast, f.k)) : '–'}</td><td>${ist}</td></tr>`;
  }
  const hold = holding(id);
  const ti = targetInfo(id);
  const myAlerts = (alerts.alerts || []).filter(a => a.stock === id);
  h += `<div class="extras">
    <div class="card"><h3>Prognosen <small>${DISCLAIMER}</small></h3><table class="fct"><thead><tr><th></th><th>Prognose</th><th>Ziel</th><th>Ist (Abw.)</th></tr></thead><tbody>${fcRows}</tbody></table>
      <p class="small">Erstellt jeweils um 09:00 (Basis: Kurs 09:00); Ist = Schlusskurs am Zieltag.</p></div>
    <div class="card"><h3>Analysten, Dividende, Termine</h3>
      ${ti ? `<div class="kv" title="${esc(ti.tip)}"><span>Kursziel 12 Mt. (Konsens)</span><b>${ti.mean != null ? `${p2(ti.mean)} <span class="${chgCls(ti.up)}t">${pct(ti.up)}</span>` : 'keine Daten'}</b></div>` : ''}
      ${ti?.t?.count ? `<div class="kv"><span>Analysten · Spanne</span><b>${ti.t.count} · ${p2(ti.t.low)} – ${p2(ti.t.high)}</b></div>` : ''}
      ${dv ? `<div class="kv" title="${esc(dv.tip)}"><span>Dividende (jährlich)</span><b>${esc(dv.text)}</b></div><div class="kv" title="${esc(dv.tip)}"><span>Nächster Ex-Tag</span><b>${dv.next ? '📅 ' + dmy(dv.next) + (dv.est ? ' (geschätzt)' : '') : '–'}</b></div>` : ''}
      ${!idx ? `<div class="kv"><span>Nächste Zahlen</span><b>${s.earningsNext ? '📅 ' + dmy(s.earningsNext) : '–'}</b></div>` : ''}
      ${s.h52 != null && p ? `<div class="kv"><span>Abstand 52W-Hoch</span><b>${pct((p.v / s.h52 - 1) * 100)}</b></div>` : ''}
    </div>
    ${idx ? '' : `<div class="card"><h3>Mein Bestand <small>nur auf diesem Gerät</small></h3>
      ${hold ? `<div class="kv"><span>Anzahl</span><b>${nf0.format(hold.qty)}</b></div><div class="kv"><span>Ø Kaufpreis</span><b>${p2(hold.avg)} ${esc(m.currency || '')}</b></div>
      <div class="kv"><span>Einstand CHF</span><b>${p2(hold.costChf)}</b></div><div class="kv"><span>Wert CHF</span><b>${p2(hold.value)}</b></div>
      <div class="kv"><span>G/V</span><b class="${lineCls(hold.gain)}t">${sgn(hold.gain)} (${pct(hold.gainPct)})</b></div><div class="kv"><span>Heute CHF</span><b class="${lineCls(hold.dayChf)}t">${sgn(hold.dayChf)}</b></div>` : '<p class="sub">Kein Bestand erfasst.</p>'}
      <button id="dDepot">Käufe erfassen …</button></div>
    <div class="card"><h3>Kursalarme <small>Push via ntfy</small></h3>
      ${myAlerts.length ? myAlerts.map(a => `<div class="kv"><span>${a.op === '<' ? 'unter' : 'über'} ${p2(a.price)}${a.note ? ' · ' + esc(a.note) : ''}</span>${canEdit() ? `<button class="danger sm" data-adel="${esc(a.id)}">✕</button>` : ''}</div>`).join('') : '<p class="sub">Keine Alarme.</p>'}
      ${canEdit() ? `<div class="row"><select id="aOp"><option value="<">unter</option><option value=">">über</option></select><input id="aPx" type="number" step="any" placeholder="Kurs" style="width:7em"><input id="aNote" placeholder="Notiz" style="width:8em"><button id="aAdd">Hinzufügen</button></div>` : '<p class="small">Zum Bearbeiten GitHub-Token unter „Bearbeiten“ eintragen.</p>'}
    </div>`}
  </div>`;
  // News
  const cutoff = Date.now() - (news.hours || 72) * 3600e3;
  const arts = (news.articles || []).filter(a => a.stocks.includes(id) && new Date(a.time) >= cutoff);
  h += `<h2 class="nh">News <small class="sub">letzte 72 Stunden · ${esc(news.source || 'Google News')}</small></h2><div class="ngrid">${arts.length ? arts.map(newsCard).join('') : '<p class="sub">Keine Artikel aus den letzten 72 Stunden.</p>'}</div>`;
  const el = $('detail'); el.innerHTML = h;
  el.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { range = b.dataset.r; prefs.range = range; savePrefs(); renderDetail(id); });
  $('back').onclick = () => { document.body.classList.remove('show-main'); };
  const dd = $('dDepot'); if (dd) dd.onclick = () => { renderDepot(id); $('depot').showModal(); };
  const aa = $('aAdd'); if (aa) aa.onclick = () => {
    const price = +$('aPx').value; if (!(price > 0)) return showError('Bitte Kurs für den Alarm eingeben.');
    const a = { id: crypto.randomUUID(), stock: id, op: $('aOp').value, price, note: $('aNote').value.trim(), enabled: true, created: new Date().toISOString() };
    editFile('alerts', cur => { (cur.alerts ||= []).push(a); }, 'Alarme geändert');
  };
  el.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => editFile('alerts', cur => { cur.alerts = (cur.alerts || []).filter(a => a.id !== b.dataset.adel); }, 'Alarme geändert'));
  wireChart();
}
function newsCard(a) {
  const snip = a.snippet && a.snippet !== a.title ? `<p>${esc(a.snippet)}</p>` : '';
  return `<a class="nc" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer"><span class="src">${esc(a.source || '–')}</span><b>${esc(a.title)}</b>${snip}<span class="age" title="${esc(timeFmt.format(new Date(a.time)))}">${ageText(a.time)}</span></a>`;
}

// ---------------------------------------------------------------- Info-Popover (Liste + Übersicht)
const infoBtn = id => `<button type="button" class="ib" data-popbtn="${esc(id)}" aria-label="Details anzeigen" tabindex="-1">i</button>`;
/** Prognosen: jüngste Prognose je Horizont und jüngster Ist-Vergleich (wie im Detail) */
function fcSummary(id) {
  return FC.map(f => {
    const ks = Object.keys(quotes.days || {}).filter(k => fcOf(id, k, f.k) != null).sort();
    const kLast = ks[ks.length - 1];
    const kDone = [...ks].reverse().find(k => actualOf(id, k, f.k));
    const v = kLast ? fcOf(id, kLast, f.k) : null, b = kLast ? val(id, kLast, HOURS[0]) : null;
    const a = kDone ? actualOf(id, kDone, f.k) : null, pv = kDone ? fcOf(id, kDone, f.k) : null;
    return { f, v, b, target: kLast ? targetOf(kLast, f.k) : null, a, pv, kDone };
  }).filter(x => x.v != null || x.a);
}
function popHtml(id) {
  const it = itemOf(id), m = meta(id), s = stats(id), c = dayChange(id), p = nowPrice(id), idx = isIndex(id), l = live.q[id] || {};
  const pick = (a, b) => (a != null ? a : b);
  const kv = (k, v, cls = '', wide = false) => (v == null || v === '–' || v === '' ? '' : `<div class="pkv${wide ? ' w' : ''}"><span>${k}</span><b${cls ? ` class="${cls}"` : ''}>${v}</b></div>`);
  const grp = (title, body, extra = '') => (body ? `<section><h4>${title}${extra}</h4>${body}</section>` : '');
  const ex = EXCH_NAME[m.exchange] || m.exchange || id.split(':')[0];
  let h = `<header><div><b>${esc(symOf(id))}</b> <span class="pn">${esc(m.longName || itemName(it))}</span><div class="psub">${esc(ex)} · ${esc(ccyLabel(id))} · ${esc(catOf(it))}</div></div>
    <div class="pp"><b>${p ? p2(p.v) : '–'}</b><span class="${chgCls(c?.pct)}t">${c ? `${sgn(c.abs)} (${pct(c.pct)})` : ''}</span></div></header>`;
  // Kennzahlen
  const dist = p && s.h52 ? (p.v / s.h52 - 1) * 100 : null;
  h += grp('Kennzahlen', `<div class="pgrid">${[
    kv('Eröffnung', p2(pick(l.open, s.open))), kv('Hoch', p2(pick(l.high, s.high))), kv('Tief', p2(pick(l.low, s.low))),
    kv('Vol.', big(pick(l.volume, s.volume))), kv('Ø-Vol.', big(s.avgVol)),
    idx ? '' : kv('Marktkap.', s.mcap ? big(s.mcap) + (s.mcapCcy ? ' ' + esc(s.mcapCcy) : '') : null), idx || !s.mcapChf || s.mcapCcy === 'CHF' ? '' : kv('Marktk. CHF', 'ca. ' + big(s.mcapChf)),
    kv('52W-H', p2(s.h52)), kv('52W-T', p2(s.l52)), kv('Abst. 52W-H', ok(dist) ? pct(dist) : null, dist < -20 ? 'downt' : ''),
    kv('KGV', p2(s.pe)), kv('EPS', p2(s.eps)), kv('Beta', p2(s.beta))].join('')}</div>`);
  // Zeitpunkte heute (bzw. letzter Tag mit Werten)
  const today = zurichToday();
  const dk = HOURS.some(hr => val(id, today, hr) != null) ? today : Object.keys(quotes.days || {}).sort().reverse().find(k => HOURS.some(hr => val(id, k, hr) != null));
  if (dk) {
    const b = val(id, dk, HOURS[0]);
    const cells = HOURS.map(hr => { const v = val(id, dk, hr); const d = v != null && b != null && hr !== HOURS[0] ? v - b : null;
      return `<div><span>${pad(hr)}:00</span><b class="${d == null ? '' : lineCls(d) + 't'}">${v == null ? '–' : p2(v)}</b></div>`; }).join('');
    const cl = closeOf(id, dk);
    h += grp(`Zeitpunkte <small>${dk === today ? 'heute' : header(dk)} · CH-Zeit</small>`, `<div class="pslots">${cells}<div><span>Schluss</span><b>${cl == null ? '–' : p2(cl)}</b></div></div>`);
  }
  // Prognosen
  const fcs = fcSummary(id);
  if (fcs.length) {
    h += grp(`Prognosen <small>${DISCLAIMER}</small>`, `<table class="pfc"><thead><tr><th></th><th>Prognose</th><th>Ziel</th><th>Ist (Abw.)</th></tr></thead><tbody>${fcs.map(x =>
      `<tr><th>${x.f.short}</th><td>${x.v != null ? p2(x.v) : '–'}${x.v != null && x.b ? ` <small class="${lineCls(x.v - x.b)}t">${pct((x.v / x.b - 1) * 100)}</small>` : ''}</td><td>${x.target ? dmyShort(x.target) : '–'}</td>` +
      `<td>${x.a ? `${p2(x.a.v)} <small class="${chgCls((x.a.v / x.pv - 1) * 100)}t">${pct((x.a.v / x.pv - 1) * 100)}</small>` : '<span class="psub">offen</span>'}</td></tr>`).join('')}</tbody></table>`);
  }
  // Analysten
  const ti = targetInfo(id);
  if (ti) h += grp('Analysten', ti.mean == null ? '<p class="psub">Kein Kursziel verfügbar.</p>' : `<div class="pgrid">${kv('Kursziel 12 Mt.', p2(ti.mean) + (ti.t.currency ? ' ' + esc(ti.t.currency) : ''))}${kv('Potenzial', pct(ti.up), chgCls(ti.up) + 't')}${ti.t.count ? kv('Analysten', String(ti.t.count)) : ''}${ti.t.low != null ? kv('Spanne', `${p2(ti.t.low)} – ${p2(ti.t.high)}`) : ''}</div>`);
  // Dividende / Termine
  if (!idx) {
    const d = quotes.dividends?.[id], dv = divInfo(id), ccy = esc(m.currency || '');
    let body = '';
    if (dv && dv.yield !== undefined) {
      body += kv('Dividende/Jahr', d.annual != null ? `${p2(d.annual)} ${ccy}` : '–') + kv('Rendite', ok(dv.yield) ? nf2.format(dv.yield) + ' %' : '–');
      body += kv('Ex-Tag', d.nextEx ? dmyShort(d.nextEx) + (d.nextEstimated ? ' (gesch.)' : '') : '–') + kv('Zahltag', d.nextPay ? dmyShort(d.nextPay) + (d.nextEstimated ? ' (gesch.)' : '') : '–');
      if (d.nextAmount) body += kv('Betrag', `${p2(d.nextAmount)} ${ccy}`);
    } else body += kv('Dividende', dv ? esc(dv.text) : '–');
    body += kv('Quartalszahlen', s.earningsNext ? dmyShort(s.earningsNext) : '–');
    h += grp('Dividende &amp; Termine', `<div class="pgrid">${body}</div>`);
  }
  // Mein Bestand
  const hold = holding(id);
  if (hold) h += grp('Mein Bestand', `<div class="pgrid">${kv('Anzahl', nf0.format(hold.qty))}${kv('Ø Kaufpreis', p2(hold.avg))}${kv('Einstand CHF', p2(hold.costChf))}${kv('Wert CHF', p2(hold.value))}${kv('Heute CHF', sgn(hold.dayChf), lineCls(hold.dayChf) + 't')}${kv('G/V CHF', `${sgn(hold.gain)} (${pct(hold.gainPct)})`, lineCls(hold.gain) + 't')}</div>`, ' <small>nur auf diesem Gerät</small>');
  return h;
}
const pop = { el: null, id: null, anchor: null, pinned: false, showT: 0, hideT: 0, html: '', x: null, lp: null, suppressClick: false };
function popEl() {
  if (!pop.el) {
    pop.el = document.createElement('div'); pop.el.id = 'pop'; pop.el.className = 'pop'; pop.el.setAttribute('role', 'tooltip'); pop.el.hidden = true;
    document.body.appendChild(pop.el);
    pop.el.addEventListener('pointerenter', () => clearTimeout(pop.hideT));
    pop.el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pop.pinned) popHideSoon(); });
  }
  return pop.el;
}
function popPlace() {
  const el = pop.el, a = pop.anchor; if (!el || !a || !a.isConnected) return;
  const M = 8, vw = document.documentElement.clientWidth, vh = window.innerHeight;
  el.style.maxHeight = (vh - 2 * M) + 'px';
  el.style.left = '0px'; el.style.top = '0px';
  const r = a.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight;
  let x, y;
  if (r.width < vw * 0.45 && (r.right + M + w <= vw - M || r.left - M - w >= M)) { // schmale Zeile (Liste): seitlich daneben
    x = r.right + M + w <= vw - M ? r.right + M : r.left - M - w;
    y = r.top - 6;
  } else { // breite Zeile (Tabelle): darunter, sonst darüber, sonst seitlich neben dem Mauszeiger
    const cx = pop.x ?? r.left + 40;
    if (r.bottom + 4 + ht <= vh - M) { x = cx - 40; y = r.bottom + 4; }
    else if (r.top - 4 - ht >= M) { x = cx - 40; y = r.top - 4 - ht; }
    else { x = cx + 28 + w <= vw - M ? cx + 28 : cx - 28 - w; y = (r.top + r.bottom) / 2 - ht / 2; }
  }
  x = Math.max(M, Math.min(x, vw - M - w)); y = Math.max(M, Math.min(y, vh - M - ht));
  el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
}
function popShow(id, anchor, pinned = false) {
  const el = popEl(); clearTimeout(pop.hideT); clearTimeout(pop.showT);
  const html = popHtml(id);
  if (html !== pop.html) { el.innerHTML = html; pop.html = html; el.scrollTop = 0; }
  const wasHidden = el.hidden;
  pop.id = id; pop.anchor = anchor; pop.pinned = pinned;
  el.classList.toggle('pinned', pinned);
  if (wasHidden) { el.classList.remove('in'); el.hidden = false; }
  popPlace();
  if (wasHidden) requestAnimationFrame(() => el.classList.add('in'));
}
function popHide() { clearTimeout(pop.showT); clearTimeout(pop.hideT); if (pop.el) { pop.el.hidden = true; pop.el.classList.remove('in'); } pop.id = null; pop.anchor = null; pop.pinned = false; }
function popHideSoon() { clearTimeout(pop.hideT); pop.hideT = setTimeout(popHide, 180); }
/** nach dem Neuzeichnen: offenes Popover an die neue Zeile hängen (kein Flackern) */
function popRefresh() {
  if (!pop.id || !pop.anchor) return;
  if (pop.anchor.isConnected) return popPlace();
  const sel = `[data-pop="${CSS.escape(pop.id)}"]`;
  const inList = pop.fromList;
  const n = document.querySelector((inList ? '#list ' : '#main ') + sel);
  if (!n || n.offsetParent === null) return popHide();
  pop.anchor = n;
  const html = popHtml(pop.id); if (html !== pop.html) { pop.el.innerHTML = html; pop.html = html; }
  popPlace();
}
function wirePopover() {
  const rowOf = t => t?.closest?.('[data-pop]');
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    if (pop.el && pop.el.contains(e.target)) { clearTimeout(pop.hideT); return; }
    const row = rowOf(e.target);
    if (!row) return;
    if (pop.pinned && pop.anchor === row) return;
    clearTimeout(pop.hideT);
    if (pop.anchor === row && !pop.el.hidden) return;
    clearTimeout(pop.showT);
    const go = () => { pop.fromList = !!row.closest('#list'); popShow(row.dataset.pop, row); };
    pop.showT = setTimeout(go, pop.el && !pop.el.hidden ? 90 : 350);
  });
  document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !(pop.el && !pop.el.hidden)) pop.x = e.clientX; }, { passive: true });
  document.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse' || pop.pinned) return;
    const row = rowOf(e.target); if (!row) return;
    const to = e.relatedTarget;
    if (to && (row.contains(to) || (pop.el && pop.el.contains(to)))) return;
    if (to && rowOf(to)) return; // zur nächsten Zeile: pointerover übernimmt
    clearTimeout(pop.showT); popHideSoon();
  });
  // Touch: Info-Knopf antippen oder lange drücken
  document.addEventListener('click', e => {
    if (pop.suppressClick) { pop.suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const b = e.target.closest?.('[data-popbtn]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      const row = b.closest('[data-pop]') || b;
      if (pop.id === b.dataset.popbtn && pop.pinned) return popHide();
      pop.fromList = !!row.closest('#list'); pop.x = null; popShow(b.dataset.popbtn, row, true); return;
    }
    if (pop.pinned && !(pop.el && pop.el.contains(e.target))) popHide();
  }, true);
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') { if (pop.pinned && !(pop.el && pop.el.contains(e.target)) && !e.target.closest('[data-popbtn]')) popHide(); return; }
    const row = rowOf(e.target); if (!row || e.target.closest('[data-popbtn]')) return;
    const sx = e.clientX, sy = e.clientY;
    clearTimeout(pop.lp);
    pop.lp = setTimeout(() => { pop.suppressClick = true; pop.fromList = !!row.closest('#list'); pop.x = sx; popShow(row.dataset.pop, row, true); if (navigator.vibrate) navigator.vibrate(10); }, 500);
    const cancel = ev => { if (ev.type !== 'pointermove' || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) { clearTimeout(pop.lp); off(); } };
    const off = () => ['pointermove', 'pointerup', 'pointercancel'].forEach(t => document.removeEventListener(t, cancel));
    ['pointermove', 'pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, cancel, { passive: true }));
  }, { passive: true });
  document.addEventListener('contextmenu', e => { if (e.target.closest?.('[data-pop]') && (pop.suppressClick || pop.pinned)) e.preventDefault(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') popHide(); });
  document.addEventListener('scroll', e => { if (pop.el && !pop.el.hidden && !pop.el.contains(e.target)) popHide(); }, true);
  window.addEventListener('resize', () => popHide());
}

// ---------------------------------------------------------------- Rendern
function render() {
  if (selected && !(watch.items || []).some(i => i.id === selected)) selected = null;
  renderSidebar();
  if (!selected) selected = orderedItems()[0]?.id ?? null; // keine Übersicht mehr: immer ein Titel im Detail
  $('detail').hidden = !selected; $('emptyMain').hidden = !!selected;
  if (selected) renderDetail(selected);
  const upd = quotes.updated ? new Date(quotes.updated) : null;
  $('stand').textContent = upd ? `Stand ${timeFmt.format(upd)}` : 'Noch keine Kursdaten';
  $('updated').textContent = live.ok ? `Jetzt-Kurse ${hmFmt.format(live.time)} (verzögert)` : 'Jetzt-Kurse nicht verfügbar';
  if (editing) renderEditor();
  popRefresh();
}

// ---------------------------------------------------------------- Laden
function showError(msg) { const e = $('error'); e.hidden = !msg; e.textContent = msg || ''; e.className = 'error'; }
function showOk(msg) { const e = $('error'); e.hidden = !msg; e.textContent = msg || ''; e.className = 'ok'; }
async function load() {
  try {
    const [w, q, n, a] = await Promise.all([fetchBlob(FILES.watch), fetchBlob(FILES.quotes), fetchBlob(FILES.news).catch(() => null), fetchBlob(FILES.alerts).catch(() => null)]);
    if (w.salt !== keySalt) { logout(); showLogin('Das Passwort wurde geändert. Bitte neu anmelden.'); return; }
    watch = await decryptBlob(w); quotes = await decryptBlob(q); news = n ? await decryptBlob(n) : { articles: [] };
    if (a && !alertsDirty) alerts = await decryptBlob(a);
    try { localStorage.setItem(LS.cache, JSON.stringify({ w, q, n, a })); } catch { /* Speicher voll */ }
    showError('');
  } catch (e) {
    if (e.name === 'OperationError') { logout(); showLogin('Entschlüsselung fehlgeschlagen. Bitte Passwort neu eingeben.'); return; }
    showError(navigator.onLine === false ? 'Keine Internetverbindung. Es werden die zuletzt geladenen Daten angezeigt.' : `Die Daten konnten nicht geladen werden (${e.message}).`);
  }
  restoreSelection();
  render();
  loadCharts();
  loadLive();
}
let alertsDirty = false;
async function loadCharts() {
  try { charts = await decryptBlob(await fetchBlob(FILES.charts)); render(); } catch { /* ohne Charts */ }
}
async function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS.cache) || 'null'); if (!c) return;
    watch = await decryptBlob(c.w); quotes = await decryptBlob(c.q); news = c.n ? await decryptBlob(c.n) : { articles: [] };
    if (c.a) alerts = await decryptBlob(c.a);
    restoreSelection(); render();
  } catch { /* ignorieren */ }
}
function restoreSelection() {
  if (selected === null && prefs.sel && (watch.items || []).some(i => i.id === prefs.sel)) selected = prefs.sel;
  range = RANGES.includes(prefs.range) ? prefs.range : '1T';
}
async function tvScan(tickers, columns) {
  const r = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ symbols: { tickers }, columns }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).data || [];
}
const LIVE_COLS = ['close', 'change', 'change_abs', 'update_time', 'open', 'high', 'low', 'volume'];
async function loadLive() {
  const ids = (watch.items || []).map(i => i.id); if (!ids.length) return;
  const ccys = [...new Set(ids.map(id => ccyInfo(meta(id).currency)[0]).filter(c => c && c !== 'CHF'))];
  try {
    const data = await tvScan([...ids, ...ccys.map(c => `FX_IDC:${c}CHF`)], LIVE_COLS);
    const q = {}, fx = {};
    for (const x of data) {
      if (x.s.startsWith('FX_IDC:')) fx[x.s.slice(7, 10)] = x.d[0];
      else if (x.d[0] != null) q[x.s] = Object.fromEntries(LIVE_COLS.map((c, i) => [c, x.d[i]]));
    }
    live = { q, fx, time: new Date(), ok: Object.keys(q).length > 0 };
  } catch { live = { q: {}, fx: {}, time: null, ok: false }; }
  render();
}

// ---------------------------------------------------------------- GitHub (Watchlist / Alarme bearbeiten)
const token = () => localStorage.getItem(LS.token) || '';
const canEdit = () => !!token();
let editing = false;
async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=main`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (r.status === 404) return { sha: null, blob: null };
  if (!r.ok) throw new Error(r.status === 401 ? 'Token ungültig oder abgelaufen' : `GitHub HTTP ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, blob: JSON.parse(new TextDecoder().decode(b64d(j.content.replace(/\n/g, '')))) };
}
/** Änderung auf den aktuellen Stand im Repo anwenden, neu verschlüsseln und committen (bei Konflikt erneut). Commit-Text ohne Ticker. */
async function commitFile(kind, mutate, message) {
  const path = FILES[kind];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, blob } = await ghGet(path);
    if (blob && blob.salt !== keySalt) throw new Error('Passwort im Repo wurde geändert – bitte neu anmelden');
    const cur = blob ? await decryptBlob(blob) : (kind === 'alerts' ? { version: 1, alerts: [] } : { version: 2, categories: [], items: [] });
    mutate(cur);
    const enc = await encryptObj(cur);
    const body = { message, branch: 'main', content: b64e(new TextEncoder().encode(JSON.stringify(enc, null, 1) + '\n')) };
    if (sha) body.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { if (kind === 'watch') watch = cur; else { alerts = cur; alertsDirty = true; } return; }
    if (r.status !== 409 && r.status !== 422) throw new Error(r.status === 403 ? 'Token ohne Schreibrecht (Contents: Read and write)' : `GitHub HTTP ${r.status}`);
  }
  throw new Error('Konflikt beim Speichern – bitte erneut versuchen');
}
async function editFile(kind, mutate, message) {
  try {
    showOk('Speichere …');
    await commitFile(kind, mutate, message);
    showOk(kind === 'watch' ? 'Gespeichert. Kurse neuer Titel erscheinen nach dem nächsten Abruf (ca. 3–5 Minuten).' : 'Alarm gespeichert. Er wird ab dem nächsten Lauf (alle 15 Min.) geprüft.');
    render();
  } catch (e) { showError(`Speichern fehlgeschlagen: ${e.message}`); }
}
const edit = (mutate, message) => editFile('watch', mutate, message);
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
      // Yahoo-Schreibweise (NESN.SW, BMW.DE, AZN.L, BRK-A) zuerst direkt prüfen
      const m = q.toUpperCase().match(/^([A-Z0-9]+)(?:[.-]([A-Z]{1,2}))?$/);
      if (m) {
        const suf = { SW: ['SIX'], DE: ['XETR'], L: ['LSE'], PA: ['EURONEXT'], AS: ['EURONEXT'], MI: ['MIL'] }[m[2]];
        const t = suf ? m[1] : q.toUpperCase().replace('-', '.');
        const cand = (suf || ['NASDAQ', 'NYSE', 'AMEX', 'OTC']).map(e => `${e}:${t}`);
        try { for (const x of await tvScan(cand, cols)) res.push(x); } catch { /* weiter mit Namenssuche */ }
      }
      const body = { filter: [{ left: 'name,description', operation: 'match', right: q }, { left: 'type', operation: 'in_range', right: ['stock', 'dr', 'fund'] },
        { left: 'exchange', operation: 'in_range', right: EXCH_PREF }], columns: cols, sort: { sortBy: 'market_cap_basic', sortOrder: 'desc', nullsFirst: false }, range: [0, 30] };
      const r = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
      for (const x of ((await r.json()).data || [])) if (!res.some(y => y.s === x.s)) res.push(x);
    }
  } catch (e) { showError(`Suche fehlgeschlagen (${e.message}). Ticker z. B. als NESN.SW, AAPL oder SIX:NESN eingeben.`); }
  const list = res.map(x => { const d = Object.fromEntries(cols.map((c, i) => [c, x.d[i]])); return { id: x.s, name: d.description, desc: d.description, exchange: d.exchange, type: d.type, currency: d.currency, close: d.close, category: categoryFor(d.sector, d.industry, d.type) }; })
    .filter(r => !(r.exchange === 'MIL' && /^1/.test(ticker(r.id))) && !(r.exchange === 'LSE' && /^0/.test(ticker(r.id))));
  searchResults = [...idx, ...list].slice(0, 15);
  if (!searchResults.length) showError(`Kein Titel gefunden für „${q}“.`);
  renderEditor();
}
function yahooSymbol(r) {
  const t = ticker(r.id); const ex = r.id.split(':')[0];
  return { SIX: t + '.SW', XETR: t + '.DE', LSE: t + '.L', EURONEXT: t + '.PA', MIL: t + '.MI' }[ex] || t.replace('.', '-');
}
function renderEditor() {
  const el = $('editor'); el.hidden = !editing;
  $('editBtn').classList.toggle('on', editing);
  if (!editing) return;
  const rw = canEdit();
  const items = orderedItems();
  const cats = categoryChoices();
  let h = `<div class="row"><h2 style="flex:1">Watchlist bearbeiten</h2><button id="edClose">Fertig</button></div>`;
  h += rw ? '<p class="sub">Änderungen werden verschlüsselt im Repository gespeichert und gelten für Web- und Mac-App.</p>'
    : '<p class="sub">Nur-Lesen: Ohne GitHub-Token lässt sich nur die Reihenfolge auf diesem Gerät ändern. Token unten eintragen, um Titel hinzuzufügen, zu löschen, Kategorien und Kursalarme zu ändern.</p>';
  if (rw) {
    h += `<div class="row"><input id="q" placeholder="Name oder Ticker (z. B. Siemens, NESN.SW, AAPL)" size="34"><button id="qBtn">Suchen</button></div><ul class="results">` +
      searchResults.map((r, i) => `<li><span>${esc(r.name)} <span class="tick">${esc(r.id)} · ${esc(r.type === 'index' ? 'Index' : r.currency || '')}${r.close != null ? ' · ' + p2(r.close) : ''} · ${esc(r.category)}</span></span>${(watch.items || []).some(x => x.id === r.id) ? '<span class="sub">vorhanden</span>' : `<button data-add="${i}">Hinzufügen</button>`}</li>`).join('') + '</ul>';
  }
  h += `<p class="sub">Eigene Reihenfolge: Zeilen ziehen oder mit ▲▼ verschieben (auch direkt in der Liste links, Sortierung „Eigene Reihenfolge“).</p><ul class="wl" id="wl">`;
  for (const it of orderedItemsManual()) {
    h += `<li draggable="true" data-id="${esc(it.id)}"><span class="grip" title="Ziehen">≡</span><span class="nm">${esc(symOf(it.id))} <span class="tick">${esc(itemName(it))}</span></span>
      <button data-up="${esc(it.id)}" title="nach oben">▲</button><button data-down="${esc(it.id)}" title="nach unten">▼</button>
      <select data-cat="${esc(it.id)}" ${rw ? '' : 'disabled'}>${cats.map(c => `<option ${c === catOf(it) ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">Neue Kategorie …</option></select>
      <button class="danger" data-del="${esc(it.id)}" ${rw ? '' : 'disabled'} title="Löschen">✕</button></li>`;
  }
  h += '</ul>';
  if (rw) h += `<div class="row"><button id="newCat">Neue Kategorie</button><button id="tokOut" class="danger">Token entfernen</button></div>`;
  else h += `<div class="row"><input id="tok" type="password" placeholder="GitHub-Token (github_pat_…)" size="34" autocomplete="off"><button id="tokSave">Token speichern</button></div>
      <p class="small">Der Token wird nur in diesem Browser gespeichert (localStorage) und nur an api.github.com gesendet.</p>`;
  el.innerHTML = h;
  wireEditor();
}
function orderedItemsManual() { const s = prefs.sort; prefs.sort = 'manual'; const r = orderedItems(); prefs.sort = s; return r; }
function moveTo(ids) {
  if (prefs.sort !== 'manual') { prefs.sort = 'manual'; savePrefs(); }
  if (canEdit()) edit(cur => { const by = Object.fromEntries(cur.items.map(i => [i.id, i])); cur.items = [...ids.filter(i => by[i]).map(i => by[i]), ...cur.items.filter(i => !ids.includes(i.id))]; }, 'Watchlist geändert');
  else { prefs.order = ids; savePrefs(); render(); }
}
function wireEditor() {
  const el = $('editor');
  $('edClose').onclick = () => { editing = false; renderEditor(); };
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
    edit(cur => { if (cur.items.some(i => i.id === r.id)) return; const item = { id: r.id, symbol: r.type === 'index' ? r.name : yahooSymbol(r), name, category: r.category, added: zurichToday() }; if (r.cnbc) item.cnbc = r.cnbc; cur.items.push(item); if (!cur.categories.includes(r.category)) cur.categories.push(r.category); }, 'Watchlist geändert');
    searchResults = [];
  });
  const q = el.querySelector('#q'); if (q) { q.onkeydown = e => { if (e.key === 'Enter') search(q.value); }; el.querySelector('#qBtn').onclick = () => search(q.value); }
  const nc = el.querySelector('#newCat'); if (nc) nc.onclick = () => { const c = (prompt('Name der neuen Kategorie:') || '').trim(); if (c) edit(cur => { if (!cur.categories.includes(c)) cur.categories.push(c); }, 'Watchlist geändert'); };
  const ts = el.querySelector('#tokSave'); if (ts) ts.onclick = async () => {
    const t = el.querySelector('#tok').value.trim(); if (!t) return;
    localStorage.setItem(LS.token, t);
    try { await ghGet(FILES.watch); showOk('Token gespeichert – Bearbeiten ist aktiv.'); } catch (e) { localStorage.removeItem(LS.token); showError(`Token abgelehnt: ${e.message}`); }
    render();
  };
  const to = el.querySelector('#tokOut'); if (to) to.onclick = () => { localStorage.removeItem(LS.token); render(); };
}
// ---------------------------------------------------------------- Depot-Dialog
function renderDepot(focusId) {
  const dlg = $('depot');
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
  $('app').hidden = true; $('login').hidden = false;
  const e = $('loginErr'); e.hidden = !msg; e.textContent = msg || '';
  $('pw').value = ''; $('pw').focus();
}
function showApp() { $('login').hidden = true; $('app').hidden = false; }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Prüfe …';
  try { await unlock($('pw').value, $('remember').checked); $('pw').value = ''; showApp(); await load(); fillMissingFx(); }
  catch (err) { const el = $('loginErr'); el.hidden = false; el.textContent = err.message === 'Falsches Passwort.' ? 'Falsches Passwort.' : `Fehler: ${err.message}`; }
  finally { btn.disabled = false; btn.textContent = 'Entsperren'; }
});
$('reload').addEventListener('click', load);
$('logout').addEventListener('click', e => { e.preventDefault(); logout(); });
$('sort').addEventListener('change', e => { prefs.sort = e.target.value; savePrefs(); render(); });
$('sparkSel').addEventListener('change', e => { prefs.spark = e.target.value; savePrefs(); render(); });
$('search').addEventListener('input', e => { searchQ = e.target.value; renderSidebar(); });
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') { const li = $('list').querySelector('li[data-id]'); if (li) select(li.dataset.id); } });
wirePopover();
$('editBtn').addEventListener('click', () => { editing = !editing; searchResults = []; renderEditor(); if (editing) document.body.classList.add('show-main'); });
$('depotBtn').addEventListener('click', () => { renderDepot(selected && !isIndex(selected) ? selected : undefined); $('depot').showModal(); });
$('backOv').addEventListener('click', () => document.body.classList.remove('show-main'));
$('csv').addEventListener('click', e => {
  e.preventDefault();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv;charset=utf-8' }));
  a.download = `Aktienuebersicht_${zurichToday()}.csv`; a.click();
});
document.addEventListener('keydown', e => {
  if (!selected || e.target.closest('input,select,textarea') || !(e.key === 'ArrowDown' || e.key === 'ArrowUp')) return;
  const ids = orderedItems().map(i => i.id); const i = ids.indexOf(selected); const j = e.key === 'ArrowDown' ? i + 1 : i - 1;
  if (j >= 0 && j < ids.length) { e.preventDefault(); select(ids[j]); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && cryptoKey) load(); });
setInterval(() => { if (cryptoKey && !document.hidden) loadLive(); }, 2 * 60 * 1000);
setInterval(() => { if (cryptoKey && !document.hidden) load(); }, 15 * 60 * 1000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (await restoreKey()) { showApp(); await loadCache(); await load(); fillMissingFx(); }
  else showLogin();
})();
