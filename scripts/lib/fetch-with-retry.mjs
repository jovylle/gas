export async function fetchWithRetry(url, opts = {}) {
  const {
    attempts = 4,
    minDelay = 250,
    maxDelay = 3000,
    factor = 2,
    jitter = true,
    fetchFn = globalThis.fetch,
  } = opts;

  let attempt = 0;
  let delay = minDelay;

  while (attempt < attempts) {
    attempt++;
    try {
      console.log(`Fetching ${url} (attempt ${attempt}/${attempts})`);
      const res = await fetchFn(url, opts.fetchOptions || {});
      if (!res.ok) {
        const body = await res.text().catch(() => "<no-body>");
        const err = new Error(`HTTP ${res.status} ${res.statusText} — ${body}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (err) {
      console.warn(`Attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt >= attempts) {
        console.error(`All ${attempts} attempts failed for ${url}`);
        throw err;
      }
      let wait = Math.min(delay, maxDelay);
      if (jitter) wait = Math.floor(wait * (0.5 + Math.random() * 0.5));
      await new Promise((r) => setTimeout(r, wait));
      delay *= factor;
    }
  }
}
