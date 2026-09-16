/**
 * National Weather Service (api.weather.gov) hourly forecast for a stadium and kickoff window.
 * Public, keyless; requires a User-Agent that identifies the app and a contact.
 */
import { nowIso } from "./format.js";

const TIMEOUT_MS = 30000;

function base(): string {
  return (process.env.NWS_API_BASE || "https://api.weather.gov").replace(/\/$/, "");
}

function ua(): string {
  return process.env.NWS_USER_AGENT || "nfl-market-mcp-server/1.0 (set NWS_USER_AGENT with a contact email)";
}

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua(), Accept: "application/geo+json" }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`NWS returned HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`NWS timed out for ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const pointsCache = new Map<string, { hourly: string; grid: string; office: string }>();

export async function resolvePoint(lat: number, lon: number) {
  const k = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (pointsCache.has(k)) return pointsCache.get(k)!;
  const j = await getJson(`${base()}/points/${k}`);
  const p = j.properties ?? {};
  if (!p.forecastHourly) throw new Error("NWS /points response has no forecastHourly URL (location may be outside NWS coverage — e.g. an international game).");
  const v = { hourly: p.forecastHourly as string, grid: p.forecastGridData as string, office: `${p.gridId}/${p.gridX},${p.gridY}` };
  pointsCache.set(k, v);
  return v;
}

export interface HourRow {
  start: string;
  temp_f: number | null;
  wind_mph: number | null;
  wind_dir: string | null;
  gust_mph: number | null;
  precip_prob: number | null;
  short: string | null;
}

function parseMph(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const nums = s.match(/\d+(\.\d+)?/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

/** Parse "2026-09-17T20:00:00+00:00/PT3H" into [start, end] epoch ms. */
function interval(validTime: string): [number, number] {
  const [startS, dur] = validTime.split("/");
  const start = Date.parse(startS);
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(dur ?? "");
  const hours = m ? (Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60) : 1;
  return [start, start + hours * 3600_000];
}

export async function kickoffForecast(lat: number, lon: number, kickoffIso: string, hoursBefore: number, hoursAfter: number) {
  const pt = await resolvePoint(lat, lon);
  const hourly = await getJson(pt.hourly);
  let gusts: { values?: { validTime: string; value: number | null }[]; uom?: string } | undefined;
  let gustNote = "";
  try {
    const grid = await getJson(pt.grid);
    gusts = grid.properties?.windGust;
  } catch (e) {
    gustNote = `gusts unavailable (${(e as Error).message})`;
  }
  const k = Date.parse(kickoffIso);
  if (!Number.isFinite(k)) throw new Error(`Invalid kickoff time: ${kickoffIso}`);
  const from = k - hoursBefore * 3600_000;
  const to = k + hoursAfter * 3600_000;
  const periods: any[] = hourly.properties?.periods ?? [];
  const rows: HourRow[] = [];
  for (const p of periods) {
    const s = Date.parse(p.startTime);
    if (s < from || s > to) continue;
    let gust: number | null = null;
    for (const g of gusts?.values ?? []) {
      const [a, b] = interval(g.validTime);
      if (s >= a && s < b && g.value != null) {
        const uom = gusts?.uom ?? "wmoUnit:km_h-1";
        const mph = uom.includes("m_s") ? g.value * 2.23694 : uom.includes("km_h") ? g.value * 0.621371 : g.value;
        gust = Math.round(mph);
        break;
      }
    }
    rows.push({
      start: p.startTime,
      temp_f: typeof p.temperature === "number" ? (p.temperatureUnit === "C" ? Math.round(p.temperature * 9 / 5 + 32) : p.temperature) : null,
      wind_mph: parseMph(p.windSpeed),
      wind_dir: p.windDirection ?? null,
      gust_mph: gust,
      precip_prob: p.probabilityOfPrecipitation?.value ?? null,
      short: p.shortForecast ?? null,
    });
  }
  const lastPeriodEnd = periods.length ? Date.parse(periods[periods.length - 1].endTime) : NaN;
  return {
    grid: pt.office,
    forecast_updated: hourly.properties?.updateTime ?? null,
    forecast_generated: hourly.properties?.generatedAt ?? null,
    retrieved_at: nowIso(),
    rows,
    beyond_horizon: Number.isFinite(lastPeriodEnd) && k > lastPeriodEnd,
    gust_note: gustNote,
  };
}
