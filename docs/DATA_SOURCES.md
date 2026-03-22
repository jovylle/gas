# Where fuel data comes from (and how “daily” works)

## What this project does today

| Layer | What it is | How often it updates |
|--------|------------|----------------------|
| **OpenVan.camp API** | Aggregated retail fuel prices per country; `fetched_at` per row | You pull it whenever the workflow runs; **OpenVan’s own per-country date** is when *they* last saw that country’s source move—not always daily. |
| **GitHub Actions** | `scripts/fetch-fuel.mjs` → `data/fuel.json`, `data/latest.json`, `data/history.json` | **Scheduled daily** (see `.github/workflows/update-fuel.yml`). If the API returns the same bytes, git may not commit. |
| **GlobalPetrolPrices** | Iran-war % table (scraped) | When the workflow runs and the scrape succeeds. |
| **Frankfurter (ECB)** | FX for USD/PHP in the browser | Live at page load. |

So: **the repo can update every day** while **some country rows still show an older “source quote” date**—that’s normal. It means the upstream national source or OpenVan’s merge for that country hasn’t published a newer number yet.

## If you need “more daily” or country-specific freshness

1. **`data/overrides.json`**  
   You can pin prices (and optional `updated_at`, `source_note`) for specific countries.  
   `mergeOverrides` already uses `updated_at` from the override when set—good for **Philippines DOE**, etc., if you paste numbers manually or from another script.

2. **Official national sources** (examples; URLs change—verify before relying)  
   - Philippines: Department of Energy (DOE) fuel price bulletin / media releases.  
   - EU: Weekly Oil Bulletin (often **weekly**, not daily).  
   - US: EIA weekly retail gasoline (weekly).  
   These are authoritative for **one country** but **not** one global daily feed.

3. **GlobalPetrolPrices**  
   You already use their **war %** table. They also publish country pages; terms, scraping rules, and freshness vary—check their license.

4. **Commercial / paid APIs**  
   There are paid “fuel price API” aggregators; evaluate cost, coverage, and licensing for your use case.

5. **Second source in code**  
   A follow-up feature would be: `fetch-fuel.mjs` merges a **secondary provider** or **HTTP GET to a government JSON** for a whitelist of codes, then merges into `fuel.json`. That’s engineering work, not a single URL for “every country daily.”

## Bottom line

- **Daily automation** = already here (GitHub Actions).  
- **Daily *per-country* price freshness** = not guaranteed by any single free global API; use **overrides**, **extra sources**, or **accept** that some rows lag.
