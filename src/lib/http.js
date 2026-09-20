// Tiny cached-fetch helper. Every adapter uses this so we never hammer the
// sponsor APIs and always return fast reads. Cache is in-memory, per-URL.
import { config } from "../config.js";

const cache = new Map(); // url -> { at: number, data }

export async function cachedFetch(url, { ttlMs = config.cacheTtlMs, headers = {}, retries = 1 } = {}) {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.data;

  async function attempt() {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AfterHours/0.1 (hackathon build)",
        Accept: "application/json",
        ...headers,
      },
      timeout: 12_000,
    });

    if (!res.ok) {
      let body = "";
      try { body = (await res.text()).slice(0, 140); } catch {}
      // NEVER leak credentials: redact query-string API keys from every
      // surfaced error (they render on the public page).
      const safeUrl = url.replace(/[?&]apikey=[^&]+/gi, "[key-redacted]");
      const safeBody = body.replace(/[?&]apikey=[^&]+/gi, "[key-redacted]");
      throw Object.assign(new Error(`GET ${safeUrl} -> ${res.status} ${safeBody}`), {
        status: res.status,
        url,
      });
    }
    return res.json();
  }

  // Retry transient upstream 5xx / network blips once (sponsor APIs are flaky).
  for (let i = 0; ; i++) {
    try {
      const data = await attempt();
      cache.set(url, { at: Date.now(), data });
      return data;
    } catch (e) {
      const isTransient = e.status >= 500 || !e.status;
      if (!isTransient || i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

export function clearCache() {
  cache.clear();
}