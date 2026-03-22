const DATA_URL = "data/fuel.json";
const WAR_URL = "data/war_deltas.json";
const HISTORY_URL = "data/history.json";

let raw = [];
let warPayload = null;
let historyPayload = null;
let sortKey = "country";
let sortDir = "asc";

/** Frankfurter: rates[CCY] = foreign currency units per 1 USD */
let usdRates = null;

let chartCompare = null;
let chartHistory = null;

/** ISO alpha-2 → regional-indicator flag emoji (e.g. US → 🇺🇸). */
function flagEmoji(code) {
  if (!code || String(code).length !== 2) return "";
  const c = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const base = 0x1f1e6;
  try {
    return String.fromCodePoint(
      base + c.charCodeAt(0) - 65,
      base + c.charCodeAt(1) - 65
    );
  } catch {
    return "";
  }
}

/** Country filter: empty set = show all. */
const selectedFilterCodes = new Set();

const LS_FAV = "fuel_favorites_v1";
const LS_ALERT = "fuel_alert_v1";

let countryPickerBound = false;

function getFavorites() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_FAV) || "[]");
    return new Set(Array.isArray(j) ? j : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(set) {
  localStorage.setItem(LS_FAV, JSON.stringify([...set]));
}

function toggleFavorite(code) {
  const s = getFavorites();
  if (s.has(code)) s.delete(code);
  else s.add(code);
  saveFavorites(s);
}

function getAlertConfig() {
  try {
    return JSON.parse(localStorage.getItem(LS_ALERT) || "null");
  } catch {
    return null;
  }
}

function saveAlertConfig(cfg) {
  if (cfg == null) localStorage.removeItem(LS_ALERT);
  else localStorage.setItem(LS_ALERT, JSON.stringify(cfg));
}

function formatMoney(value, currency) {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return String(value);
  }
}

/** Frankfurter: rates[CCY] = units of CCY per 1 USD */
function toUsd(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  const c = currency || "USD";
  if (c === "USD") return Number(amount);
  if (!usdRates || !c) return null;
  const r = usdRates[c];
  if (r == null || r === 0) return null;
  return Number(amount) / r;
}

function getDisplayMode() {
  return (
    document.querySelector('input[name="currencyMode"]:checked')?.value || "usd"
  );
}

function toPhp(amount, currency) {
  const usd = toUsd(amount, currency);
  if (usd == null || !usdRates?.PHP) return null;
  return usd * usdRates.PHP;
}

function displayPrice(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  const mode = getDisplayMode();
  if (mode === "local") return formatMoney(amount, currency);
  if (mode === "php") {
    const p = toPhp(amount, currency);
    return p != null ? formatMoney(p, "PHP") : formatMoney(amount, currency);
  }
  const u = toUsd(amount, currency);
  if (u != null) return formatMoney(u, "USD");
  return formatMoney(amount, currency);
}

/** Positive % = pump price up vs baseline (bad for drivers) → red; negative → green */
function formatGpSubline(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return "";
  const n = Number(pct);
  const ico = n > 0 ? "↑" : n < 0 ? "↓" : "→";
  const cls =
    n > 0 ? "gp-sub--worse" : n < 0 ? "gp-sub--better" : "gp-sub--flat";
  const num = n.toLocaleString("en", { maximumFractionDigits: 2 });
  const pctStr = (n > 0 ? "+" : "") + num + "%";
  return `<span class="gp-sub ${cls}" title="Change since Feb 23 (GlobalPetrolPrices vs pre-war baseline). ↑ = higher pump price (tougher on drivers)."><span class="gp-sub-ico" aria-hidden="true">${ico}</span><span class="gp-sub-pct">${escapeHtml(pctStr)}</span></span>`;
}

function priceCellHtml(price, currency, gpPct, code, field) {
  const main = displayPrice(price, currency);
  const delta = code && field ? formatDeltaLineHtml(code, field) : "";
  const sub = formatGpSubline(gpPct);
  if (!delta && !sub) return main;
  let inner = `<span class="price-main">${main}</span>`;
  if (delta) inner += `<span class="price-delta-wrap">${delta}</span>`;
  if (sub) inner += sub;
  return `<div class="price-stack">${inner}</div>`;
}

function comparePriceForSort(a, b, key) {
  const ua = toUsd(a[key], a.currency);
  const ub = toUsd(b[key], b.currency);
  if (ua != null && ub != null) return ua - ub;
  const va = a[key];
  const vb = b[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  return Number(va) - Number(vb);
}

function historyDeltaFor(code, field) {
  const series = historySeriesFor(code);
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const row = rowByCode(code);
  if (!row) return null;
  const prevVal = prev[field];
  const currVal = row[field];
  if (prevVal == null || currVal == null) return null;
  const deltaLocal = currVal - prevVal;
  const pct = prevVal !== 0 ? (deltaLocal / prevVal) * 100 : 0;
  return { deltaLocal, pct, prevVal, currVal };
}

function formatSignedDelta(d, currency, mode) {
  const { prevVal, currVal, deltaLocal } = d;
  let amount;
  if (mode === "local") {
    amount = deltaLocal;
  } else if (mode === "usd") {
    const cu = toUsd(currVal, currency);
    const pu = toUsd(prevVal, currency);
    if (cu == null || pu == null) return "";
    amount = cu - pu;
  } else if (mode === "php") {
    const cu = toPhp(currVal, currency);
    const pu = toPhp(prevVal, currency);
    if (cu == null || pu == null) return "";
    amount = cu - pu;
  } else {
    amount = deltaLocal;
  }
  const sign = amount >= 0 ? "+" : "−";
  const ccy =
    mode === "local"
      ? currency
      : mode === "usd"
        ? "USD"
        : mode === "php"
          ? "PHP"
          : currency;
  try {
    const num = Math.abs(amount);
    const formatted = new Intl.NumberFormat("en", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 4,
    }).format(num);
    return `${sign}${formatted}`;
  } catch {
    return `${sign}${Math.abs(amount)}`;
  }
}

function formatDeltaLineHtml(code, field) {
  const d = historyDeltaFor(code, field);
  if (!d) return "";
  const row = rowByCode(code);
  if (!row) return "";
  const mode = getDisplayMode();
  const str = formatSignedDelta(d, row.currency, mode);
  if (!str) return "";
  const localUp = d.deltaLocal > 0;
  const cls =
    localUp
      ? "delta-line--worse"
      : d.deltaLocal < 0
        ? "delta-line--better"
        : "delta-line--flat";
  const icon = d.deltaLocal > 0 ? "▲" : d.deltaLocal < 0 ? "▼" : "—";
  const pctStr =
    d.pct != null && !Number.isNaN(d.pct)
      ? ` (${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(1)}%)`
      : "";
  return `<span class="delta-line ${cls}" title="Versus previous snapshot in repo history">${icon} ${escapeHtml(str)}${escapeHtml(pctStr)}</span>`;
}

function compare(a, b, key) {
  if (key === "country") {
    return String(a.country).localeCompare(String(b.country), "en");
  }
  if (key === "war_gas_pct" || key === "war_diesel_pct") {
    const field = key === "war_gas_pct" ? "gasoline_pct" : "diesel_pct";
    const va = warPayload?.by_country_code?.[a.country_code]?.[field];
    const vb = warPayload?.by_country_code?.[b.country_code]?.[field];
    const na = va == null || Number.isNaN(Number(va));
    const nb = vb == null || Number.isNaN(Number(vb));
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return Number(va) - Number(vb);
  }

  if (key === "updated_at") {
    return String(a.updated_at).localeCompare(String(b.updated_at), "en");
  }

  if (key === "gasoline" || key === "diesel") {
    return comparePriceForSort(a, b, key);
  }

  const va = a[key];
  const vb = b[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  return Number(va) - Number(vb);
}

function warPctFor(row) {
  const w = warPayload?.by_country_code?.[row.country_code];
  if (!w) return null;
  return {
    gasoline_pct: w.gasoline_pct,
    diesel_pct: w.diesel_pct,
  };
}

function impliedPreWar(price, pct) {
  if (price == null || pct == null || Number.isNaN(pct)) return null;
  return price / (1 + pct / 100);
}

function hasGpWarRow(r) {
  const w = warPayload?.by_country_code?.[r.country_code];
  return (
    w != null &&
    (w.gasoline_pct != null || w.diesel_pct != null)
  );
}

function filtered() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const warSel = document.getElementById("filterWar")?.value ?? "";

  return raw.filter((r) => {
    if (q) {
      const name = r.country.toLowerCase();
      const code = r.country_code.toLowerCase();
      if (!name.includes(q) && !code.includes(q)) return false;
    }
    if (selectedFilterCodes.size > 0 && !selectedFilterCodes.has(r.country_code)) {
      return false;
    }
    if (warSel === "gp" && !hasGpWarRow(r)) return false;
    if (warSel === "nogp" && hasGpWarRow(r)) return false;
    return true;
  });
}

function sorted(rows) {
  const out = [...rows];
  const favFirst = document.getElementById("toggleFavFirst")?.checked ?? true;
  const fav = getFavorites();
  const sortFn = (a, b) => {
    const c = compare(a, b, sortKey);
    return sortDir === "asc" ? c : -c;
  };
  if (favFirst && fav.size > 0) {
    out.sort((a, b) => {
      const af = fav.has(a.country_code) ? 1 : 0;
      const bf = fav.has(b.country_code) ? 1 : 0;
      if (bf !== af) return bf - af;
      return sortFn(a, b);
    });
  } else {
    out.sort(sortFn);
  }
  return out;
}

function render() {
  const tbody = document.getElementById("tbody");
  const empty = document.getElementById("empty");
  const rows = sorted(filtered());

  const countEl = document.getElementById("tableCount");
  if (countEl) {
    countEl.textContent = `Showing ${rows.length} of ${raw.length} countries`;
  }

  tbody.replaceChildren();
  if (rows.length === 0) {
    empty.hidden = false;
    applyColumnVisibility();
    renderInsights();
    renderWeeklySummary();
    renderComparison();
    renderAlertBanner();
    return;
  }
  empty.hidden = true;

  const fav = getFavorites();
  for (const r of rows) {
    const w = warPctFor(r);
    const flag = flagEmoji(r.country_code);
    const isFav = fav.has(r.country_code);
    const star = isFav ? "★" : "☆";
    const tr = document.createElement("tr");
    tr.dataset.code = r.country_code;
    tr.innerHTML = `
      <td class="country-cell">
        <button type="button" class="fav-star" data-code="${escapeHtml(r.country_code)}" aria-label="Toggle favorite for ${escapeHtml(r.country)}" aria-pressed="${isFav}">${star}</button>
        <span class="country-flag" aria-hidden="true">${escapeHtml(flag)}</span>
        <span class="country-name">${escapeHtml(r.country)}</span>
      </td>
      <td class="num col-gas">${priceCellHtml(r.gasoline, r.currency, w?.gasoline_pct, r.country_code, "gasoline")}</td>
      <td class="num col-die">${priceCellHtml(r.diesel, r.currency, w?.diesel_pct, r.country_code, "diesel")}</td>
      <td class="num col-updated">${formatUpdatedCell(r.updated_at)}</td>
    `;
    tbody.appendChild(tr);
  }

  applyColumnVisibility();
  renderInsights();
  renderWeeklySummary();
  renderComparison();
  renderAlertBanner();
}

function bindFavoriteStars() {
  const wrap = document.querySelector(".table-wrap");
  if (!wrap || wrap.dataset.favBound) return;
  wrap.dataset.favBound = "1";
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".fav-star");
    if (!btn?.dataset.code) return;
    e.preventDefault();
    toggleFavorite(btn.dataset.code);
    render();
  });
}

function applyColumnVisibility() {
  const showGas = document.getElementById("toggleColGas")?.checked ?? false;
  const showDie = document.getElementById("toggleColDiesel")?.checked ?? true;
  document.querySelectorAll(".col-gas").forEach((el) => {
    el.classList.toggle("table-col-hidden", !showGas);
  });
  document.querySelectorAll(".col-die").forEach((el) => {
    el.classList.toggle("table-col-hidden", !showDie);
  });
}

function rowByCode(code) {
  return raw.find((x) => x.country_code === code);
}

function renderCountryChips() {
  const wrap = document.getElementById("countryPickerChips");
  if (!wrap) return;
  wrap.replaceChildren();
  const codes = [...selectedFilterCodes].sort((a, b) => {
    const na = rowByCode(a)?.country ?? a;
    const nb = rowByCode(b)?.country ?? b;
    return na.localeCompare(nb, "en");
  });
  for (const code of codes) {
    const r = rowByCode(code);
    const label = r ? `${r.country} (${code})` : code;
    const chip = document.createElement("span");
    chip.className = "country-chip";
    chip.innerHTML = `<span class="country-chip-flag" aria-hidden="true">${escapeHtml(flagEmoji(code))}</span><span class="country-chip-label">${escapeHtml(label)}</span>`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "country-chip-remove";
    rm.setAttribute("aria-label", `Remove ${label} from filter`);
    rm.dataset.code = code;
    rm.textContent = "×";
    chip.appendChild(rm);
    wrap.appendChild(chip);
  }
  wrap.querySelectorAll(".country-chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedFilterCodes.delete(btn.dataset.code);
      renderCountryChips();
      const inp = document.getElementById("countryPickerSearch");
      if (inp && document.activeElement === inp) openCountryPickerList();
      render();
    });
  });
}

function availableForPicker() {
  return raw.filter((r) => !selectedFilterCodes.has(r.country_code));
}

function openCountryPickerList() {
  const input = document.getElementById("countryPickerSearch");
  const list = document.getElementById("countryPickerList");
  if (!input || !list) return;
  const q = input.value.trim().toLowerCase();
  let pool = availableForPicker();
  if (q) {
    pool = pool.filter(
      (r) =>
        r.country.toLowerCase().includes(q) ||
        r.country_code.toLowerCase().includes(q)
    );
  }
  pool.sort((a, b) => a.country.localeCompare(b.country, "en"));
  const items = pool.slice(0, 14);
  list.replaceChildren();
  for (const r of items) {
    const li = document.createElement("li");
    li.role = "option";
    li.dataset.code = r.country_code;
    li.innerHTML = `<span class="country-picker-flag" aria-hidden="true">${escapeHtml(flagEmoji(r.country_code))}</span><span>${escapeHtml(r.country)}</span><span class="country-picker-code">${escapeHtml(r.country_code)}</span>`;
    list.appendChild(li);
  }
  list.hidden = items.length === 0;
  input.setAttribute("aria-expanded", items.length > 0 ? "true" : "false");
}

function hideCountryPickerList() {
  const list = document.getElementById("countryPickerList");
  const input = document.getElementById("countryPickerSearch");
  if (list) list.hidden = true;
  if (input) input.setAttribute("aria-expanded", "false");
}

function bindCountryPicker() {
  if (countryPickerBound) return;
  const input = document.getElementById("countryPickerSearch");
  const list = document.getElementById("countryPickerList");
  const wrap = document.getElementById("countryPicker");
  if (!input || !list || !wrap) return;
  countryPickerBound = true;

  input.addEventListener("input", () => {
    openCountryPickerList();
  });

  input.addEventListener("focus", () => {
    openCountryPickerList();
  });

  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-code]");
    if (li) e.preventDefault();
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-code]");
    if (!li) return;
    const code = li.dataset.code;
    if (code) {
      selectedFilterCodes.add(code);
      input.value = "";
      hideCountryPickerList();
      renderCountryChips();
      render();
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) hideCountryPickerList();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideCountryPickerList();
      input.blur();
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseISODate(s) {
  if (!s) return null;
  const p = String(s).slice(0, 10);
  const [y, m, d] = p.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function daysSince(isoDate) {
  const t = parseISODate(isoDate);
  if (!t) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t.getTime()) / 86400000);
}

function formatUpdatedCell(isoDate) {
  const days = daysSince(isoDate);
  const rel =
    days == null
      ? "—"
      : days === 0
        ? "today"
        : days === 1
          ? "1 day ago"
          : `${days} days ago`;
  const stale = days != null && days > 7;
  const badge = stale
    ? `<span class="freshness freshness--stale" title="Quote older than 7 days">⚠</span>`
    : `<span class="freshness freshness--ok" title="Recently updated">✓</span>`;
  return `<div class="updated-cell"><span class="updated-date">${escapeHtml(isoDate || "—")}</span><span class="updated-rel">${escapeHtml(rel)}</span>${badge}</div>`;
}

function renderInsights() {
  const el = document.getElementById("insightsStrip");
  if (!el || raw.length === 0) return;
  let cheapestG = null;
  let expensiveG = null;
  for (const r of raw) {
    if (r.gasoline == null) continue;
    const u = toUsd(r.gasoline, r.currency);
    if (u == null) continue;
    if (!cheapestG || u < cheapestG.u) cheapestG = { r, u };
    if (!expensiveG || u > expensiveG.u) expensiveG = { r, u };
  }
  let biggest = null;
  for (const r of raw) {
    const d = historyDeltaFor(r.country_code, "gasoline");
    if (!d || d.deltaLocal <= 0) continue;
    if (!biggest || d.pct > biggest.d.pct) biggest = { r, d };
  }
  const parts = [];
  if (cheapestG) {
    parts.push(
      `<span class="insight-item"><span class="insight-k">Cheapest gas (USD)</span> ${escapeHtml(cheapestG.r.country)} <span class="insight-flag" aria-hidden="true">${escapeHtml(flagEmoji(cheapestG.r.country_code))}</span></span>`
    );
  }
  if (expensiveG) {
    parts.push(
      `<span class="insight-item"><span class="insight-k">Priciest gas (USD)</span> ${escapeHtml(expensiveG.r.country)} <span class="insight-flag" aria-hidden="true">${escapeHtml(flagEmoji(expensiveG.r.country_code))}</span></span>`
    );
  }
  if (biggest) {
    parts.push(
      `<span class="insight-item"><span class="insight-k">Largest gas jump vs prior snapshot</span> ${escapeHtml(biggest.r.country)} <span class="insight-flag" aria-hidden="true">${escapeHtml(flagEmoji(biggest.r.country_code))}</span> ▲${biggest.d.pct.toFixed(1)}%</span>`
    );
  }
  if (parts.length === 0) {
    el.innerHTML =
      '<span class="muted">Insights need loaded prices (and history for jump).</span>';
    return;
  }
  el.innerHTML = parts.join('<span class="insight-sep" aria-hidden="true">·</span>');
}

function renderWeeklySummary() {
  const el = document.getElementById("weeklySummary");
  if (!el) return;
  const snaps = historyPayload?.snapshots || [];
  if (snaps.length < 2) {
    el.hidden = true;
    return;
  }
  const dates = snaps.map((s) => s.date).sort();
  el.textContent = `Repo history: ${snaps.length} snapshots from ${dates[0]} to ${dates[dates.length - 1]} — more runs sharpen trends and Δ lines.`;
  el.hidden = false;
}

function renderComparison() {
  const out = document.getElementById("compareOut");
  const a = document.getElementById("compareA")?.value;
  const b = document.getElementById("compareB")?.value;
  if (!out || !a || !b || a === b) {
    if (out) out.innerHTML = a === b ? "<p class=\"compare-hint\">Pick two different countries.</p>" : "";
    return;
  }
  const ra = rowByCode(a);
  const rb = rowByCode(b);
  if (!ra || !rb) {
    out.innerHTML = "";
    return;
  }
  const card = (r) => {
    const g = toUsd(r.gasoline, r.currency);
    const di = toUsd(r.diesel, r.currency);
    const gl = g != null ? formatMoney(g, "USD") : "—";
    const dl = di != null ? formatMoney(di, "USD") : "—";
    return `<div class="compare-card"><h3>${escapeHtml(r.country)} <span aria-hidden="true">${escapeHtml(flagEmoji(r.country_code))}</span></h3><p>Gasoline: ${gl}</p><p>Diesel: ${dl}</p></div>`;
  };
  const gau = toUsd(ra.gasoline, ra.currency);
  const gbu = toUsd(rb.gasoline, rb.currency);
  let diffLine = "";
  if (gau != null && gbu != null) {
    const diff = gau - gbu;
    const pct = gbu !== 0 ? (diff / Math.abs(gbu)) * 100 : null;
    diffLine = `<p class="compare-diff">Gasoline (USD), A − B: <strong>${diff >= 0 ? "+" : ""}${diff.toFixed(4)} USD</strong>${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs B)` : ""}</p>`;
  }
  out.innerHTML = `<div class="compare-grid">${card(ra)}${card(rb)}</div>${diffLine}`;
}

function renderAlertBanner() {
  const bar = document.getElementById("alertsBanner");
  if (!bar) return;
  const cfg = getAlertConfig();
  if (!cfg?.country_code || cfg.gasBelow == null) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  const r = rowByCode(cfg.country_code);
  if (!r || r.gasoline == null) {
    bar.hidden = true;
    return;
  }
  if (r.gasoline < cfg.gasBelow) {
    bar.innerHTML = `<strong>Alert:</strong> ${escapeHtml(r.country)} gasoline is ${formatMoney(r.gasoline, r.currency)} — below your ${cfg.gasBelow} threshold.`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
    bar.innerHTML = "";
  }
}

function fillCountrySelect(sel, preferredCode) {
  if (!sel) return;
  const sortedRows = [...raw].sort((a, b) =>
    a.country.localeCompare(b.country, "en")
  );
  sel.replaceChildren();
  for (const r of sortedRows) {
    const opt = document.createElement("option");
    opt.value = r.country_code;
    opt.textContent = `${r.country} (${r.country_code})`;
    sel.appendChild(opt);
  }
  if (preferredCode && sortedRows.some((x) => x.country_code === preferredCode)) {
    sel.value = preferredCode;
  } else {
    const prefer = ["US", "PH", "GB", "DE", "JP"];
    const pick =
      prefer.find((c) => raw.some((x) => x.country_code === c)) ||
      sortedRows[0]?.country_code;
    if (pick) sel.value = pick;
  }
}

function populateCompareSelects() {
  const a = document.getElementById("compareA");
  const b = document.getElementById("compareB");
  if (!a || !b) return;
  const ka = a.value;
  const kb = b.value;
  fillCountrySelect(a, ka || null);
  fillCountrySelect(b, kb || null);
  if (!ka && raw.some((r) => r.country_code === "PH")) a.value = "PH";
  if (!kb && raw.some((r) => r.country_code === "MY")) b.value = "MY";
  if (a.value === b.value) {
    const alt = raw.find((r) => r.country_code !== a.value);
    if (alt) b.value = alt.country_code;
  }
}

function populateAlertCountry() {
  const sel = document.getElementById("alertCountry");
  if (!sel) return;
  const cfg = getAlertConfig();
  const cur = cfg?.country_code || "";
  sel.replaceChildren();
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "—";
  sel.appendChild(opt0);
  for (const r of [...raw].sort((a, b) =>
    a.country.localeCompare(b.country, "en")
  )) {
    const opt = document.createElement("option");
    opt.value = r.country_code;
    opt.textContent = `${r.country} (${r.country_code})`;
    sel.appendChild(opt);
  }
  sel.value = cur;
  const gas = document.getElementById("alertGasBelow");
  if (gas && cfg?.gasBelow != null) gas.value = String(cfg.gasBelow);
}

function filterHistorySeries(series, range) {
  if (range === "all" || !series || series.length === 0) return series;
  const last = new Date(series[series.length - 1].date + "T12:00:00Z");
  const days = range === "7d" ? 7 : 30;
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutStr = cutoff.toISOString().slice(0, 10);
  const filtered = series.filter((p) => p.date >= cutStr);
  return filtered.length >= 2 ? filtered : series;
}

function applyHighlightParam() {
  const p = new URLSearchParams(location.search).get("highlight");
  if (!p) return;
  const code = p.toUpperCase();
  requestAnimationFrame(() => {
    document.querySelector(`tr[data-code="${code}"]`)?.classList.add("row-highlight");
  });
}

function updateSortButtons() {
  document.querySelectorAll("button.sort").forEach((btn) => {
    const key = btn.dataset.sort;
    const active = key === sortKey;
    btn.classList.toggle("is-active", active);
    const ind = btn.querySelector(".sort-ind");
    if (ind) {
      ind.textContent = active ? (sortDir === "asc" ? "↑" : "↓") : "";
    }
    const th = btn.closest("th");
    if (th) {
      if (active) {
        th.setAttribute(
          "aria-sort",
          sortDir === "asc" ? "ascending" : "descending"
        );
      } else {
        th.setAttribute("aria-sort", "none");
      }
    }
  });
}

function populateCountrySelect() {
  const sel = document.getElementById("chartCountry");
  const prev = sel?.value;
  fillCountrySelect(sel, prev || null);
}

function historySeriesFor(code) {
  const snaps = historyPayload?.snapshots || [];
  const pts = [];
  for (const s of snaps) {
    const row = s.by_code?.[code];
    if (!row) continue;
    pts.push({
      date: s.date,
      gasoline: row.gasoline,
      diesel: row.diesel,
      currency: row.currency,
    });
  }
  return pts;
}

function applyChartTheme() {
  const Chart = window.Chart;
  if (!Chart) return;
  Chart.defaults.color = "#9a9388";
  Chart.defaults.borderColor = "rgba(255,245,220,0.12)";
  const leg = Chart.defaults.plugins.legend.labels;
  leg.color = "#e8e4dc";
}

function destroyChart(ch) {
  if (ch) {
    ch.destroy();
  }
}

function renderCompareChart(code) {
  const canvas = document.getElementById("chartCompare");
  const hint = document.getElementById("chartCompareHint");
  if (!canvas || !window.Chart) return;
  const row = raw.find((r) => r.country_code === code);
  const w = warPayload?.by_country_code?.[code];
  destroyChart(chartCompare);
  chartCompare = null;

  if (!row || !w) {
    hint.textContent =
      "No Iran-war comparison row for this country (GlobalPetrolPrices table may omit it).";
    hint.hidden = false;
    return;
  }
  hint.hidden = true;

  const gCur = row.gasoline;
  const dCur = row.diesel;
  const gIm = impliedPreWar(gCur, w.gasoline_pct);
  const dIm = impliedPreWar(dCur, w.diesel_pct);
  const cc = row.currency;

  const pairs = [];
  if (gCur != null && gIm != null) pairs.push(["Gasoline", gCur, gIm]);
  if (dCur != null && dIm != null && w.diesel_pct != null) {
    pairs.push(["Diesel", dCur, dIm]);
  }

  if (pairs.length === 0) {
    hint.textContent = "Not enough data to compare (missing prices or percentages).";
    hint.hidden = false;
    return;
  }

  const allUsd = pairs.every(
    ([, c, i]) => toUsd(c, cc) != null && toUsd(i, cc) != null
  );

  const labels = [];
  const cur = [];
  const imp = [];
  for (const [label, c, i] of pairs) {
    labels.push(label);
    if (allUsd) {
      cur.push(toUsd(c, cc));
      imp.push(toUsd(i, cc));
    } else {
      cur.push(c);
      imp.push(i);
    }
  }

  const currency = allUsd ? "USD" : cc;
  chartCompare = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: `Implied ${warPayload.meta.baseline_date} (pre-war)`,
          data: imp,
          backgroundColor: "rgba(126, 200, 255, 0.35)",
          borderColor: "rgba(126, 200, 255, 0.9)",
          borderWidth: 1,
        },
        {
          label: "Current snapshot",
          data: cur,
          backgroundColor: "rgba(240, 160, 32, 0.35)",
          borderColor: "rgba(240, 160, 32, 0.95)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `${row.country} — ${currency === "USD" ? "USD (converted)" : `same currency (${currency})`}, implied pre-war from GP % change`,
          color: "#e8e4dc",
          font: { size: 14 },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              try {
                return `${ctx.dataset.label}: ${new Intl.NumberFormat("en", {
                  style: "currency",
                  currency,
                  maximumFractionDigits: 4,
                }).format(v)}`;
              } catch {
                return `${ctx.dataset.label}: ${v}`;
              }
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9a9388" },
          grid: { color: "rgba(255,245,220,0.06)" },
        },
        y: {
          ticks: { color: "#9a9388" },
          grid: { color: "rgba(255,245,220,0.06)" },
        },
      },
    },
  });
}

function renderHistoryChart(code) {
  const canvas = document.getElementById("chartHistory");
  const hint = document.getElementById("chartHistoryHint");
  if (!canvas || !window.Chart) return;
  destroyChart(chartHistory);
  chartHistory = null;

  const range = document.getElementById("historyRange")?.value ?? "all";
  let series = historySeriesFor(code);
  series = filterHistorySeries(series, range);
  if (series.length < 2) {
    hint.textContent =
      series.length === 0
        ? "No snapshots for this country yet."
        : "Only one snapshot so far — the line chart appears after more daily workflow runs.";
    hint.hidden = false;
    return;
  }
  hint.hidden = true;

  const row = raw.find((r) => r.country_code === code);
  const cc = row?.currency || series[0].currency;
  const histUsd = series.every(
    (p) =>
      (p.gasoline == null || toUsd(p.gasoline, cc) != null) &&
      (p.diesel == null || toUsd(p.diesel, cc) != null)
  );
  const currency = histUsd ? "USD" : cc;

  chartHistory = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: series.map((p) => p.date),
      datasets: [
        {
          label: "Gasoline",
          data: series.map((p) => {
            const u = toUsd(p.gasoline, cc);
            return histUsd && p.gasoline != null && u != null ? u : p.gasoline;
          }),
          borderColor: "rgba(240, 160, 32, 0.95)",
          backgroundColor: "rgba(240, 160, 32, 0.15)",
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "Diesel",
          data: series.map((p) => {
            const u = toUsd(p.diesel, cc);
            return histUsd && p.diesel != null && u != null ? u : p.diesel;
          }),
          borderColor: "rgba(126, 200, 255, 0.9)",
          backgroundColor: "rgba(126, 200, 255, 0.12)",
          tension: 0.25,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `${row?.country || code} — history (${currency})${range !== "all" ? ` · ${range === "7d" ? "~7d" : "~30d"} window` : ""}`,
          color: "#e8e4dc",
          font: { size: 14 },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              if (v == null) return `${ctx.dataset.label}: —`;
              try {
                return `${ctx.dataset.label}: ${new Intl.NumberFormat("en", {
                  style: "currency",
                  currency,
                  maximumFractionDigits: 4,
                }).format(v)}`;
              } catch {
                return `${ctx.dataset.label}: ${v}`;
              }
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9a9388", maxRotation: 45 },
          grid: { color: "rgba(255,245,220,0.06)" },
        },
        y: {
          ticks: { color: "#9a9388" },
          grid: { color: "rgba(255,245,220,0.06)" },
        },
      },
    },
  });
}

function refreshCharts() {
  const sel = document.getElementById("chartCountry");
  const code = sel?.value;
  if (!code) return;
  applyChartTheme();
  renderCompareChart(code);
  renderHistoryChart(code);
}

document.getElementById("search").addEventListener("input", () => {
  render();
});

document.getElementById("filterWar")?.addEventListener("change", () => {
  render();
});

document.getElementById("toggleColGas")?.addEventListener("change", () => {
  applyColumnVisibility();
});

document.getElementById("toggleColDiesel")?.addEventListener("change", () => {
  applyColumnVisibility();
});

document.getElementById("clearTableFilters")?.addEventListener("click", () => {
  const search = document.getElementById("search");
  if (search) search.value = "";
  selectedFilterCodes.clear();
  const cps = document.getElementById("countryPickerSearch");
  if (cps) cps.value = "";
  renderCountryChips();
  hideCountryPickerList();
  const fw = document.getElementById("filterWar");
  if (fw) fw.value = "";
  render();
});

function bindSortButtons() {
  document.querySelectorAll("button.sort").forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true));
  });
  document.querySelectorAll("button.sort").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      if (key === sortKey) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        const ascKeys = ["country", "updated_at"];
        sortDir = ascKeys.includes(key) ? "asc" : "desc";
      }
      updateSortButtons();
      render();
    });
  });
}

bindSortButtons();

document.getElementById("chartCountry")?.addEventListener("change", refreshCharts);

document.getElementById("historyRange")?.addEventListener("change", () => {
  refreshCharts();
});

document.querySelectorAll('input[name="currencyMode"]').forEach((el) => {
  el.addEventListener("change", () => render());
});

document.getElementById("toggleFavFirst")?.addEventListener("change", () => {
  render();
});

document.getElementById("compareA")?.addEventListener("change", () => {
  renderComparison();
});

document.getElementById("compareB")?.addEventListener("change", () => {
  renderComparison();
});

document.getElementById("alertSave")?.addEventListener("click", () => {
  const code = document.getElementById("alertCountry")?.value;
  const gasRaw = document.getElementById("alertGasBelow")?.value;
  if (!code || gasRaw === "" || gasRaw == null) {
    saveAlertConfig(null);
  } else {
    const n = Number(gasRaw);
    if (Number.isNaN(n)) saveAlertConfig(null);
    else saveAlertConfig({ country_code: code, gasBelow: n });
  }
  renderAlertBanner();
});

document.getElementById("alertClear")?.addEventListener("click", () => {
  saveAlertConfig(null);
  const gas = document.getElementById("alertGasBelow");
  if (gas) gas.value = "";
  const sel = document.getElementById("alertCountry");
  if (sel) sel.value = "";
  renderAlertBanner();
});

async function load() {
  const errEl = document.getElementById("error");
  errEl.hidden = true;
  try {
    const [fuelRes, warRes, histRes, fxRes] = await Promise.all([
      fetch(DATA_URL),
      fetch(WAR_URL),
      fetch(HISTORY_URL),
      fetch("https://api.frankfurter.app/latest?from=USD").catch(() => null),
    ]);
    if (fxRes?.ok) {
      const fx = await fxRes.json();
      usdRates = fx.rates || {};
      usdRates.USD = 1;
    } else {
      usdRates = null;
    }

    if (!fuelRes.ok) throw new Error(`${fuelRes.status} ${fuelRes.statusText}`);
    const data = await fuelRes.json();
    raw = data.countries || [];
    const m = data.meta || {};
    const fxNote = usdRates
      ? " · FX: ECB via Frankfurter (use currency toggle above table)"
      : " · FX unavailable — table shows local units";
    document.getElementById("metaLine").textContent =
      `${m.countries_count ?? raw.length} countries · dataset ${m.updated_at ?? "—"}${fxNote}`;

    if (warRes.ok) {
      warPayload = await warRes.json();
    } else {
      warPayload = null;
    }

    if (histRes.ok) {
      historyPayload = await histRes.json();
    } else {
      historyPayload = { snapshots: [] };
    }

    const warMeta = document.getElementById("warMetaLine");
    if (warMeta) {
      if (warPayload?.meta) {
        warMeta.textContent = `Baseline ${warPayload.meta.baseline_date} · scraped ${(warPayload.meta.scraped_at || "").slice(0, 10)}`;
        warMeta.hidden = false;
      } else {
        warMeta.textContent = "";
        warMeta.hidden = true;
      }
    }

    if (sortKey === "war_gas_pct" || sortKey === "war_diesel_pct") {
      sortKey = "country";
      sortDir = "asc";
    }
    updateSortButtons();
    bindCountryPicker();
    renderCountryChips();
    bindFavoriteStars();
    populateCountrySelect();
    populateCompareSelects();
    populateAlertCountry();
    render();
    refreshCharts();
    applyHighlightParam();
  } catch (e) {
    errEl.textContent = `Could not load data: ${e.message}`;
    errEl.hidden = false;
  }
}

load();
