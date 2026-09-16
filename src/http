/** Shared keyless HTTP client: host allowlist, timeout, one retry on 429/5xx, friendly errors. */
import { nowIso } from "./format.js";

const TIMEOUT_MS = 30000;
const USER_AGENT = "nfl-market-mcp-server/2.0 (NF Agent)";

export const KALSHI_BASE = () => (process.env.KALSHI_API_BASE || "https://api.elections.kalshi.com/trade-api/v2").replace(/\/$/, "");
export const ESPN_SITE_BASE = () => (process.env.ESPN_SITE_BASE || "https://site.api.espn.com/apis/site/v2/sports/football/nfl").replace(/\/$/, "");
export const ESPN_CORE_BASE = () => (process.env.ESPN_CORE_BASE || "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl").replace(/\/$/, "");

const ALLOWED_HOSTS = ["api.elections.kalshi.com", "site.api.espn.com", "sports.core.api.espn.com", "api.weather.gov"];

export class SourceError extends Error {}

export function assertAllowed(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SourceError(`Invalid URL: ${rawUrl}`);
  }
  const testHosts = [process.env.KALSHI_API_BASE, process.env.ESPN_SITE_BASE, process.env.ESPN_CORE_BASE, process.env.NWS_API_BASE]
    .filter(Boolean).map((b) => new URL(b as string).host);
  if (u.protocol !== "https:" && !testHosts.includes(u.host)) throw new SourceError("Only https URLs are allowed.");
  if (!ALLOWED_HOSTS.includes(u.hostname) && !testHosts.includes(u.host)) {
    throw new SourceError(`Host ${u.hostname} is not allowed. Allowed: ${ALLOWED_HOSTS.join(", ")}.`);
  }
  return u;
}

export interface Fetched<T> {
  data: T;
  url: string;
  retrieved_at: string;
  status: number;
}

export async function getJson<T>(rawUrl: string, params: Record<string, string | undefined> = {}, headers: Record<string, string> = {}): Promise<Fetched<T>> {
  const url = assertAllowed(rawUrl);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers }, signal: ctrl.signal });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) throw new SourceError(`${url.host} returned HTTP ${res.status} for ${url.pathname}: ${text.slice(0, 200)}`);
      try {
        return { data: JSON.parse(text) as T, url: url.toString(), retrieved_at: nowIso(), status: res.status };
      } catch {
        throw new SourceError(`${url.host} returned non-JSON content for ${url.pathname}.`);
      }
    } catch (e) {
      if (e instanceof SourceError) throw e;
      lastErr = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SourceError(`${url.host} did not answer (${lastErr}). Nothing was returned — treat as NO PRICE and retry later.`);
}

/** Run async jobs with a concurrency limit. */
export async function mapLimit<A, B>(items: A[], limit: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
