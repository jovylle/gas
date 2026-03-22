const DATA_URL = "data/fuel.json";
const WAR_URL = "data/war_deltas.json";
const HISTORY_URL = "data/history.json";

let raw = [];
let warPayload = null;
let historyPayload = null;
let sortKey = "country";
let sortDir = "asc";
let chartCompare = null;
let chartHistory = null;

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
  const currency =
    document.getElementById("filterCurrency")?.value?.trim() ?? "";
  const warSel = document.getElementById("filterWar")?.value ?? "";

  return raw.filter((r) => {
    if (q) {
      const name = r.country.toLowerCase();
      const code = r.country_code.toLowerCase();
      if (!name.includes(q) && !code.includes(q)) return false;
    }
    if (currency && r.currency !== currency) return false;
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
  const showWar = !!warPayload?.by_country_code;

  const countEl = document.getElementById("tableCount");
  if (countEl) {
    countEl.textContent = `Showing ${rows.length} of ${raw.length} countries`;
  }

  tbody.replaceChildren();
  if (rows.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const r of rows) {
    const w = warPctFor(r);
    const gPct =
      w?.gasoline_pct != null ? `${w.gasoline_pct >= 0 ? "+" : ""}${w.gasoline_pct}%` : "—";
    const dPct =
      w?.diesel_pct != null ? `${w.diesel_pct >= 0 ? "+" : ""}${w.diesel_pct}%` : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.country)}</td>
      <td class="num muted">${escapeHtml(r.country_code)}</td>
      <td class="num">${formatMoney(r.gasoline, r.currency)}</td>
      <td class="num">${formatMoney(r.diesel, r.currency)}</td>
      <td class="num war-col" ${showWar ? "" : "hidden"}>${escapeHtml(gPct)}</td>
      <td class="num war-col" ${showWar ? "" : "hidden"}>${escapeHtml(dPct)}</td>
      <td class="num">${escapeHtml(r.updated_at)}</td>
    `;
    tbody.appendChild(tr);
  }

  document.querySelectorAll(".war-col-header").forEach((el) => {
    el.hidden = !showWar;
  });
}

function populateCurrencyFilter() {
  const sel = document.getElementById("filterCurrency");
  if (!sel) return;
  const prev = sel.value;
  const codes = [...new Set(raw.map((r) => r.currency))].sort();
  sel.replaceChildren();
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "All currencies";
  sel.appendChild(opt0);
  for (const c of codes) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
  if (prev && codes.includes(prev)) sel.value = prev;
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

  const labels = [];
  const cur = [];
  const imp = [];
  if (gCur != null && gIm != null) {
    labels.push("Gasoline");
    cur.push(gCur);
    imp.push(gIm);
  }
  if (dCur != null && dIm != null && w.diesel_pct != null) {
    labels.push("Diesel");
    cur.push(dCur);
    imp.push(dIm);
  }

  if (labels.length === 0) {
    hint.textContent = "Not enough data to compare (missing prices or percentages).";
    hint.hidden = false;
    return;
  }

  const currency = row.currency;
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
          text: `${row.country} — same currency (${currency}), implied pre-war from GP % change`,
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
  const currency = row?.currency || series[0].currency;

  chartHistory = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: series.map((p) => p.date),
      datasets: [
        {
          label: "Gasoline",
          data: series.map((p) => p.gasoline),
          borderColor: "rgba(240, 160, 32, 0.95)",
          backgroundColor: "rgba(240, 160, 32, 0.15)",
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "Diesel",
          data: series.map((p) => p.diesel),
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

document.getElementById("filterCurrency")?.addEventListener("change", () => {
  render();
});

document.getElementById("filterWar")?.addEventListener("change", () => {
  render();
});

document.getElementById("clearTableFilters")?.addEventListener("click", () => {
  const search = document.getElementById("search");
  if (search) search.value = "";
  const fc = document.getElementById("filterCurrency");
  if (fc) fc.value = "";
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
    const [fuelRes, warRes, histRes] = await Promise.all([
      fetch(DATA_URL),
      fetch(WAR_URL),
      fetch(HISTORY_URL),
    ]);
    if (!fuelRes.ok) throw new Error(`${fuelRes.status} ${fuelRes.statusText}`);
    const data = await fuelRes.json();
    raw = data.countries || [];
    const m = data.meta || {};
    document.getElementById("metaLine").textContent =
      `${m.countries_count ?? raw.length} countries · dataset ${m.updated_at ?? "—"}`;

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

    updateSortButtons();
    populateCurrencyFilter();
    render();
    populateCountrySelect();
    refreshCharts();
  } catch (e) {
    errEl.textContent = `Could not load data: ${e.message}`;
    errEl.hidden = false;
  }
}

load();
