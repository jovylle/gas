# Fuel tracker — product roadmap

This file tracks the evolution from **data display** → **decision-making tool**.

## Phase 1 — Quick wins (implemented in repo)

- [x] Price change indicators (▲/▼ vs prior repo snapshot, color-coded)
- [x] Last updated + relative “days ago” + freshness badge (⚠ after 7 days)
- [x] Quick insights strip (cheapest / priciest gas in USD, largest jump)
- [x] Weekly-style summary line (snapshot count + date span in `history.json`)
- [x] Currency display toggle: USD / local / PHP (ECB via Frankfurter)
- [x] Favorites (★, localStorage, optional pin-first)
- [x] Simple price alert (gas below threshold, localStorage)
- [x] History chart window: all / ~7d / ~30d
- [x] Compare two countries (USD when FX available)
- [x] Public mirror `data/latest.json` (same payload as `fuel.json`)
- [x] Embeddable `fuel-widget.js`
- [x] Data confidence copy in footer
- [x] Unified browser persistence (`localStorage` key `fuel_tracker_state_v1`: favorites, alert, sort, filters, currency mode, chart/compare selections, etc.; migrates legacy `fuel_favorites_v1` / `fuel_alert_v1`)

## Phase 2 — Interaction & reach

- [ ] Deeper trends (more snapshots / rolling windows in copy)
- [ ] Map view (choropleth)
- [ ] Geo “your country” via browser hints (limited without backend)
- [ ] Widget: optional sparkline from `history.json`

## Phase 3 — Stickiness

- [ ] Email / push (needs backend)
- [ ] User accounts (needs backend)

## Phase 4 — Advanced

- [ ] Short-horizon “likely direction” from last N points (clearly labeled heuristic)
- [ ] Per-country JSON exports (`data/history-by-code/` in CI) if needed for API consumers

---

**Principle:** prioritize *what this means* (trends, comparisons, alerts) over raw tables alone.
