/**
 * Embeddable snippet: loads data/latest.json and prints one country line.
 * Usage:
 *   <script src="fuel-widget.js" data-country="PH" data-field="gasoline" async></script>
 * data-field: gasoline | diesel (default gasoline)
 */
(function () {
  const s = document.currentScript;
  if (!s) return;
  const code = String(s.dataset.country || "PH").toUpperCase();
  const field = s.dataset.field === "diesel" ? "diesel" : "gasoline";
  let base = "";
  try {
    base = new URL(".", s.src).href;
  } catch {
    base = "";
  }
  const url = (base || "") + "data/latest.json";
  const mount = document.createElement("div");
  mount.className = "fuel-widget-embed";
  mount.style.cssText =
    "font:14px system-ui,sans-serif;padding:.5rem .75rem;border-radius:8px;background:#13161e;color:#e8e4dc;border:1px solid rgba(255,245,220,.12);display:inline-block;max-width:100%;";
  s.insertAdjacentElement("afterend", mount);
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((data) => {
      const row = data.countries?.find((x) => x.country_code === code);
      if (!row) {
        mount.textContent = "Country not in dataset.";
        return;
      }
      const v = row[field];
      const cur = row.currency || "USD";
      let price = "—";
      if (v != null && !Number.isNaN(Number(v))) {
        try {
          price = new Intl.NumberFormat("en", {
            style: "currency",
            currency: cur,
            maximumFractionDigits: 4,
          }).format(Number(v));
        } catch {
          price = String(v) + " " + cur;
        }
      }
      mount.textContent = `${row.country}: ${field} ${price}`;
    })
    .catch(() => {
      mount.textContent = "Could not load fuel data.";
    });
})();
