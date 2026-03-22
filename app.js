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

let countryPickerBound = false;

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

function displayPriceUsd(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
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

function priceCellHtml(price, currency, gpPct) {
  const main = displayPriceUsd(price, currency);
  const sub = formatGpSubline(gpPct);
  if (!sub) return main;
  return `<div class="price-stack"><span class="price-main">${main}</span>${sub}</div>`;
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

function compare(a, b, key) {
  if (key === "country") {
    return String(a.country).localeCompare(String(b.country), "en");
  }
  if (key === "country_code") {
    return String(a.country_code).localeCompare(String(b.country_code), "en");
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
  out.sort((a, b) => {
    const c = compare(a, b, sortKey);
    return sortDir === "asc" ? c : -c;
  });
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
    return;
  }
  empty.hidden = true;

  for (const r of rows) {
    const w = warPctFor(r);
    const flag = flagEmoji(r.country_code);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="country-cell">
        <span class="country-flag" aria-hidden="true">${escapeHtml(flag)}</span>
        <span class="country-name">${escapeHtml(r.country)}</span>
      </td>
      <td class="num muted">${escapeHtml(r.country_code)}</td>
      <td class="num col-gas">${priceCellHtml(r.gasoline, r.currency, w?.gasoline_pct)}</td>
      <td class="num col-die">${priceCellHtml(r.diesel, r.currency, w?.diesel_pct)}</td>
      <td class="num">${escapeHtml(r.updated_at)}</td>
    `;
    tbody.appendChild(tr);
  }

  applyColumnVisibility();
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
  if (!sel) return;
  sel.replaceChildren();
  const sortedRows = [...raw].sort((a, b) =>
    a.country.localeCompare(b.country, "en")
  );
  for (const r of sortedRows) {
    const opt = document.createElement("option");
    opt.value = r.country_code;
    opt.textContent = `${r.country} (${r.country_code})`;
    sel.appendChild(opt);
  }
  const prefer = ["US", "PH", "GB", "DE", "JP"];
  const pick =
    prefer.find((c) => raw.some((x) => x.country_code === c)) ||
    sortedRows[0]?.country_code;
  if (pick) sel.value = pick;
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

  const series = historySeriesFor(code);
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
          text: `${row?.country || code} — stored history (${currency})`,
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
        const ascKeys = ["country", "country_code", "updated_at"];
        sortDir = ascKeys.includes(key) ? "asc" : "desc";
      }
      updateSortButtons();
      render();
    });
  });
}

bindSortButtons();

document.getElementById("chartCountry")?.addEventListener("change", refreshCharts);

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
      ? " · table prices in USD (ECB via Frankfurter)"
      : " · table prices in local currency (FX unavailable)";
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
    render();
    populateCountrySelect();
    refreshCharts();
  } catch (e) {
    errEl.textContent = `Could not load data: ${e.message}`;
    errEl.hidden = false;
  }
}

load();
