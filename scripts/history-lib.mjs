/**
 * Shared helpers for data/history.json (snapshots + merge rules).
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const HISTORY_PATH = join(__dirname, "..", "data", "history.json");

const MAX_SNAPSHOTS = 400;

export const FEB23_DATE = "2026-02-23";

export async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    const h = JSON.parse(raw);
    if (!Array.isArray(h.snapshots)) h.snapshots = [];
    return h;
  } catch {
    return {
      meta: {
        description:
          "Daily snapshots from this repo (Git as database). Used for trend charts.",
      },
      snapshots: [],
    };
  }
}

export function sortSnapshots(history) {
  history.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  while (history.snapshots.length > MAX_SNAPSHOTS) {
    history.snapshots.shift();
  }
}

export async function saveHistory(history) {
  const dateStr = new Date().toISOString().slice(0, 10);
  history.meta = {
    ...history.meta,
    updated_at: dateStr,
    snapshot_count: history.snapshots.length,
  };
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf8");
}

export function impliedPreWar(price, pct) {
  if (price == null || pct == null || Number.isNaN(pct)) return null;
  return price / (1 + pct / 100);
}

/**
 * Build implied Feb 23 prices from GP % table + current fuel rows (same formula as chart).
 */
export function buildFeb23SnapshotFromGp(rows, warPayload) {
  const by_code = {};
  const wmap = warPayload?.by_country_code || {};
  for (const r of rows) {
    const w = wmap[r.country_code];
    if (!w) continue;
    const g = impliedPreWar(r.gasoline, w.gasoline_pct);
    const d =
      w.diesel_pct != null
        ? impliedPreWar(r.diesel, w.diesel_pct)
        : null;
    if (g == null && d == null) continue;
    by_code[r.country_code] = {
      currency: r.currency,
      gasoline: g,
      diesel: d,
    };
  }
  return {
    date: FEB23_DATE,
    source: "reconstructed_feb23_from_gp",
    note:
      "Implied retail prices from latest OpenVan snapshot and GlobalPetrolPrices % change since Feb 23, 2026. Fixed once first written; not an independent observation.",
    by_code,
  };
}

export function hasSnapshotForDate(history, date) {
  return (history.snapshots || []).some((s) => s.date === date);
}

export function mergeSnapshotIfMissing(history, snap) {
  if (hasSnapshotForDate(history, snap.date)) return false;
  history.snapshots.push(snap);
  sortSnapshots(history);
  return true;
}

export function upsertTodaySnapshot(history, rows, dateStr) {
  const by_code = {};
  for (const r of rows) {
    by_code[r.country_code] = {
      currency: r.currency,
      gasoline: r.gasoline,
      diesel: r.diesel,
    };
  }
  const snap = {
    date: dateStr,
    source: "openvan_daily",
    by_code,
  };
  const rest = (history.snapshots || []).filter((s) => s.date !== dateStr);
  rest.push(snap);
  history.snapshots = rest;
  sortSnapshots(history);
}
