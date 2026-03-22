#!/usr/bin/env node
/**
 * Optional manual backfill:
 *   node scripts/backfill-history.mjs --git      # merge past fuel.json from git commits
 *   node scripts/backfill-history.mjs --feb23    # only implied Feb 23 (same as fetch)
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import {
  loadHistory,
  saveHistory,
  mergeSnapshotIfMissing,
  buildFeb23SnapshotFromGp,
  hasSnapshotForDate,
  sortSnapshots,
  FEB23_DATE,
} from "./history-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FUEL_PATH = join(ROOT, "data", "fuel.json");
const WAR_PATH = join(ROOT, "data", "war_deltas.json");

function isShallowRepo() {
  try {
    const out = execSync("git rev-parse --is-shallow-repository", {
      encoding: "utf8",
      cwd: ROOT,
    }).trim();
    return out === "true";
  } catch {
    return true;
  }
}

function getFuelCommitsNewestFirst() {
  const out = execSync("git log --format=%H -- data/fuel.json", {
    encoding: "utf8",
    cwd: ROOT,
  });
  return out.trim().split("\n").filter(Boolean);
}

function showFuelAtCommit(hash) {
  return execSync(`git show ${hash}:data/fuel.json`, {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function snapshotFromFuelPayload(payload, source) {
  const date =
    payload.meta?.updated_at?.slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  const by_code = {};
  for (const r of payload.countries || []) {
    by_code[r.country_code] = {
      currency: r.currency,
      gasoline: r.gasoline,
      diesel: r.diesel,
    };
  }
  return {
    date,
    source,
    note: "Recovered from git history of data/fuel.json",
    by_code,
  };
}

export async function mergeGitFuelHistoryInto(history) {
  if (isShallowRepo()) {
    console.warn(
      "Git history backfill skipped: shallow clone (fetch-depth: 1). Use fetch-depth: 0 in CI or run locally with full history."
    );
    return { merged: 0, skipped: "shallow" };
  }
  let hashes;
  try {
    hashes = getFuelCommitsNewestFirst();
  } catch (e) {
    console.warn("Git history backfill skipped:", e.message);
    return { merged: 0, skipped: "no_git" };
  }
  if (hashes.length === 0) {
    return { merged: 0, skipped: "no_commits" };
  }

  const seenDates = new Set();
  let merged = 0;
  for (const hash of hashes) {
    let payload;
    try {
      payload = JSON.parse(showFuelAtCommit(hash));
    } catch {
      continue;
    }
    const snap = snapshotFromFuelPayload(payload, "git_fuel_json");
    if (!snap.date) continue;
    if (seenDates.has(snap.date)) continue;
    seenDates.add(snap.date);
    if (hasSnapshotForDate(history, snap.date)) continue;
    history.snapshots.push(snap);
    merged++;
  }
  sortSnapshots(history);
  return { merged };
}

export async function backfillFeb23FromFiles(history) {
  let fuelRaw;
  let warRaw;
  try {
    fuelRaw = await readFile(FUEL_PATH, "utf8");
    warRaw = await readFile(WAR_PATH, "utf8");
  } catch (e) {
    console.warn("Feb 23 backfill skipped:", e.message);
    return false;
  }
  const fuel = JSON.parse(fuelRaw);
  const war = JSON.parse(warRaw);
  if (hasSnapshotForDate(history, FEB23_DATE)) {
    return false;
  }
  const snap = buildFeb23SnapshotFromGp(fuel.countries || [], war);
  if (Object.keys(snap.by_code).length === 0) {
    console.warn("Feb 23 backfill: no countries to infer.");
    return false;
  }
  const added = mergeSnapshotIfMissing(history, snap);
  return added;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doGit = args.has("--git");
  const doFeb = args.has("--feb23") || (!doGit && args.size === 0);

  let history = await loadHistory();

  if (doFeb) {
    const ok = await backfillFeb23FromFiles(history);
    console.log(ok ? "Added Feb 23 reconstructed snapshot." : "Feb 23 skipped or already present.");
  }

  if (doGit) {
    const { merged, skipped } = await mergeGitFuelHistoryInto(history);
    if (skipped === "shallow") {
      /* message already */
    } else {
      console.log(`Git backfill: merged ${merged} new snapshot(s) by date.`);
    }
  }

  await saveHistory(history);
}

const isMain =
  import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
