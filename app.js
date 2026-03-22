const DATA_URL = new URL("data/fuel.json", import.meta.url);

let raw = [];
let sortKey = "country";
let sortDir = "asc";

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
  const va = a[key];
  const vb = b[key];
  if (key === "country") {
    return String(va).localeCompare(String(vb), "en");
  }
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  return Number(va) - Number(vb);
}

function filtered() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  if (!q) return [...raw];
  return raw.filter((r) => {
    const name = r.country.toLowerCase();
    const code = r.country_code.toLowerCase();
    return name.includes(q) || code.includes(q);
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

  tbody.replaceChildren();
  if (rows.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.country)}</td>
      <td class="num muted">${escapeHtml(r.country_code)}</td>
      <td class="num">${formatMoney(r.gasoline, r.currency)}</td>
      <td class="num">${formatMoney(r.diesel, r.currency)}</td>
      <td class="num">${escapeHtml(r.updated_at)}</td>
    `;
    tbody.appendChild(tr);
  }
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

document.getElementById("search").addEventListener("input", () => {
  render();
});

document.querySelectorAll("button.sort").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    if (key === sortKey) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = key === "country" || key === "updated_at" ? "asc" : "desc";
    }
    updateSortButtons();
    render();
  });
});

async function load() {
  const errEl = document.getElementById("error");
  errEl.hidden = true;
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    raw = data.countries || [];
    const m = data.meta || {};
    document.getElementById("metaLine").textContent =
      `${m.countries_count ?? raw.length} countries · dataset ${m.updated_at ?? "—"}`;
    updateSortButtons();
    render();
  } catch (e) {
    errEl.textContent = `Could not load data: ${e.message}`;
    errEl.hidden = false;
  }
}

load();
