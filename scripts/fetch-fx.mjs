#!/usr/bin/env node
/**
 * Fetch FX rates (USD base) for PHP conversion.
 * Frankfurter blocks browser CORS, so this runs in Node/CI and writes `data/fx.json`.
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FX_OUT = join(ROOT, "data", "fx.json");

const FX_URL = "https://api.frankfurter.app/latest?from=USD";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const res = await fetch(FX_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "fuel-price-tracker/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`FX API ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  const rates = body?.rates || {};

  // app.js expects `usdRates = fx.rates` and then sets USD=1.
  const payload = {
    meta: {
      updated_at: todayISODate(),
      source: "ECB via Frankfurter",
      source_url: FX_URL,
    },
    base: body?.base || "USD",
    date: body?.date || null,
    rates,
  };

  await writeFile(FX_OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote FX rates (${Object.keys(rates).length} currencies) to ${FX_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

