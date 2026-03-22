#!/usr/bin/env node
/**
 * Fetches retail fuel prices, normalizes to a single schema, merges data/overrides.json.
 * Primary source: https://openvan.camp/api/fuel/prices (CC BY 4.0 — attribute in UI).
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchWarDeltaRows,
  gpNameToCode,
  loadCountriesEn,
  invertCountriesEn,
} from "./war-deltas-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "fuel.json");
const OVERRIDES_PATH = join(ROOT, "data", "overrides.json");
const WAR_OUT = join(ROOT, "data", "war_deltas.json");
const HISTORY_OUT = join(ROOT, "data", "history.json");

const API = "https://openvan.camp/api/fuel/prices";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function englishRegionName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  } catch {
    return null;
  }
}

function pickPrices(entry) {
  const lp = entry.local_prices || {};
  const p = entry.prices || {};
  const hasLocal =
    lp.gasoline != null ||
    lp.diesel != null ||
    p.gasoline != null ||
    p.diesel != null;

  if (!hasLocal) return null;

  const useLocal = lp.gasoline != null || lp.diesel != null;
  const src = useLocal ? lp : p;
  const currency = useLocal
    ? entry.local_currency || entry.currency
    : entry.currency;

  return {
    gasoline: src.gasoline ?? null,
    diesel: src.diesel ?? null,
    currency: currency || "USD",
  };
}

function normalizeFromApi(dataObj) {
  const rows = [];
  for (const [code, entry] of Object.entries(dataObj || {})) {
    const picked = pickPrices(entry);
    if (!picked) continue;

    const name =
      englishRegionName(code) || entry.country_name || code;
    const fetched = entry.fetched_at
      ? String(entry.fetched_at).slice(0, 10)
      : todayISODate();

    rows.push({
      country_code: code,
      country: name,
      currency: picked.currency,
      gasoline: picked.gasoline,
      diesel: picked.diesel,
      updated_at: fetched,
      source_note: entry.source || null,
    });
  }
  return rows;
}

async function loadOverrides() {
  try {
    const raw = await readFile(OVERRIDES_PATH, "utf8");
    const o = JSON.parse(raw);
    if (typeof o !== "object" || o === null) return {};
    return o;
  } catch {
    return {};
  }
}

function mergeOverrides(rows, overrides, dateStr) {
  const byCode = new Map(rows.map((r) => [r.country_code, { ...r }]));

  for (const [code, o] of Object.entries(overrides)) {
    if (!o || typeof o !== "object") continue;
    const c = code.toUpperCase();
    const prev = byCode.get(c);
    const country = o.country ?? prev?.country ?? englishRegionName(c) ?? c;
    const row = {
      country_code: c,
      country,
      currency: o.currency ?? prev?.currency ?? "USD",
      gasoline: o.gasoline ?? prev?.gasoline ?? null,
      diesel: o.diesel ?? prev?.diesel ?? null,
      updated_at: o.updated_at ?? prev?.updated_at ?? dateStr,
      source_note: o.source_note ?? prev?.source_note ?? null,
    };
    byCode.set(c, row);
  }

  return [...byCode.values()];
}

async function writeWarDeltas() {
  const countriesEn = await loadCountriesEn();
  const nameToCode = invertCountriesEn(countriesEn);
  const rows = await fetchWarDeltaRows();
  const by_country_code = {};
  for (const r of rows) {
    const code = gpNameToCode(r.gp_name, nameToCode);
    if (!code) continue;
    by_country_code[code] = {
      gasoline_pct: r.gasoline_pct,
      diesel_pct: r.diesel_pct,
    };
  }
  const payload = {
    meta: {
      baseline_date: "2026-02-23",
      baseline_label:
        "Last weekly data before Iran war (per GlobalPetrolPrices narrative)",
      source_url:
        "https://www.globalpetrolprices.com/fuel_price_trend_Iran_war.php",
      scraped_at: new Date().toISOString(),
      rows_scraped: rows.length,
    },
    by_country_code,
  };
  await writeFile(WAR_OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote war deltas (${rows.length} rows) to ${WAR_OUT}`);
}

async function appendHistory(rows, dateStr) {
  let history = {
    meta: {
      description:
        "Daily snapshots from this repo (Git as database). Used for trend charts.",
    },
    snapshots: [],
  };
  try {
    const raw = await readFile(HISTORY_OUT, "utf8");
    history = JSON.parse(raw);
  } catch {
    /* first run */
  }
  const snap = { date: dateStr, by_code: {} };
  for (const r of rows) {
    snap.by_code[r.country_code] = {
      currency: r.currency,
      gasoline: r.gasoline,
      diesel: r.diesel,
    };
  }
  const rest = (history.snapshots || []).filter((s) => s.date !== dateStr);
  rest.push(snap);
  rest.sort((a, b) => a.date.localeCompare(b.date));
  const maxSnaps = 400;
  while (rest.length > maxSnaps) rest.shift();
  history.snapshots = rest;
  history.meta = {
    ...history.meta,
    updated_at: dateStr,
    snapshot_count: rest.length,
  };
  await writeFile(HISTORY_OUT, JSON.stringify(history, null, 2) + "\n", "utf8");
  console.log(`Wrote ${rest.length} snapshot(s) to ${HISTORY_OUT}`);
}

async function main() {
  const res = await fetch(API, {
    headers: { Accept: "application/json", "User-Agent": "fuel-price-tracker/1.0" },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (!body.success || !body.data) {
    throw new Error("Unexpected API response shape");
  }

  const dateStr = todayISODate();
  let rows = normalizeFromApi(body.data);
  const overrides = await loadOverrides();
  rows = mergeOverrides(rows, overrides, dateStr);

  rows.sort((a, b) => a.country.localeCompare(b.country, "en"));

  const payload = {
    meta: {
      updated_at: dateStr,
      source: "OpenVan.camp fuel API",
      source_url: "https://openvan.camp/api/fuel/prices",
      license: "CC BY 4.0 (attribute OpenVan.camp when displaying)",
      countries_count: rows.length,
    },
    countries: rows,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${rows.length} countries to ${OUT}`);

  await appendHistory(rows, dateStr);

  try {
    await writeWarDeltas();
  } catch (e) {
    console.warn("War deltas scrape skipped:", e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
