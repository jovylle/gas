/**
 * Shared helpers: scrape GlobalPetrolPrices Iran-war % table and map to ISO codes.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** GP label -> ISO 3166-1 alpha-2 when it does not match countries-list English names */
export const GP_NAME_TO_CODE = {
  USA: "US",
  "Burma (Myanmar)": "MM",
  Macedonia: "MK",
  "Congo": "CG",
  "Democratic Republic of the Congo": "CD",
  "Ivory Coast": "CI",
  "S.T.&Principe Dobra": "ST",
  "East Timor": "TL",
  Swaziland: "SZ",
  Turkey: "TR",
  "Wallis and Futuna Islands": "WF",
};

export async function loadCountriesEn() {
  const p = join(
    __dirname,
    "..",
    "node_modules",
    "countries-list",
    "minimal",
    "countries.en.min.json"
  );
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw);
}

export function invertCountriesEn(countriesEn) {
  const nameToCode = {};
  for (const [code, name] of Object.entries(countriesEn)) {
    nameToCode[name] = code;
  }
  return nameToCode;
}

export function gpNameToCode(gpName, nameToCode) {
  if (GP_NAME_TO_CODE[gpName]) return GP_NAME_TO_CODE[gpName];
  if (nameToCode[gpName]) return nameToCode[gpName];
  const stripped = gpName.replace(/\s*\*$/, "").trim();
  if (nameToCode[stripped]) return nameToCode[stripped];
  return null;
}

export function parseWarTableHtml(html) {
  const re =
    /<td>([^<]*)<\/td>\s*<td>([-\d.]*)%<\/td>\s*<td>([-\d.%]*)<\/td>/g;
  const rows = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    const g = parseFloat(m[2]);
    const dRaw = m[3].trim();
    const d =
      dRaw === "%" || dRaw === "" || dRaw === undefined
        ? null
        : parseFloat(dRaw);
    if (!name || Number.isNaN(g)) continue;
    rows.push({
      gp_name: name,
      gasoline_pct: g,
      diesel_pct: d == null || Number.isNaN(d) ? null : d,
    });
  }
  return rows;
}

export async function fetchWarDeltaRows() {
  const res = await fetch(
    "https://www.globalpetrolprices.com/fuel_price_trend_Iran_war.php",
    {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 fuel-price-tracker/1.0",
      },
    }
  );
  if (!res.ok) throw new Error(`GP war page ${res.status}`);
  const html = await res.text();
  return parseWarTableHtml(html);
}
