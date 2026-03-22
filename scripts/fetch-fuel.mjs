#!/usr/bin/env node
/**
 * Fetches retail fuel prices, normalizes to a single schema, merges data/overrides.json.
 * Primary source: https://openvan.camp/api/fuel/prices (CC BY 4.0 — attribute in UI).
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "fuel.json");
const OVERRIDES_PATH = join(ROOT, "data", "overrides.json");

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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
