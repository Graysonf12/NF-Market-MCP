/** ESPN public feeds (keyless, undocumented): DraftKings game lines, DK prop lines, injuries. */
import { ESPN_CORE_BASE, ESPN_SITE_BASE, getJson, mapLimit } from "./http.js";
import { espnAbbr } from "./registry.js";
import { devigPair, parseAmerican, parseLine } from "./pricing.js";

export interface DkSide {
  line: number | null;
  price: number | null;
  open_line: number | null;
  open_price: number | null;
}

export interface EspnGame {
  espn_id: string;
  kickoff: string;
  status: string;
  away: string;
  home: string;
  name: string;
  provider: string | null;
  spread: { home: DkSide; away: DkSide; vig_free_home: number | null; overround: number | null } | null;
  total: { over: DkSide; under: DkSide; vig_free_over: number | null; overround: number | null } | null;
  moneyline: { home: DkSide; away: DkSide; vig_free_home: number | null; overround: number | null } | null;
}

function side(o: any): DkSide {
  return {
    line: parseLine(o?.close?.line),
    price: parseAmerican(o?.close?.odds),
    open_line: parseLine(o?.open?.line),
    open_price: parseAmerican(o?.open?.odds),
  };
}

function pairVig(a: DkSide, b: DkSide) {
  if (a.price === null || b.price === null) return { p: null, over: null };
  const d = devigPair(a.price, b.price);
  return { p: d.pa, over: d.overround };
}

export function parseScoreboard(data: any): EspnGame[] {
  const out: EspnGame[] = [];
  for (const ev of data?.events ?? []) {
    const comp = ev.competitions?.[0] ?? {};
    const cs: any[] = comp.competitors ?? [];
    const home = cs.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "?";
    const away = cs.find((c) => c.homeAway === "away")?.team?.abbreviation ?? "?";
    const odds = (comp.odds ?? []).find((o: any) => /draftkings/i.test(o?.provider?.name ?? "")) ?? null;
    let spread = null, total = null, moneyline = null;
    if (odds) {
      if (odds.pointSpread) {
        const h = side(odds.pointSpread.home), a = side(odds.pointSpread.away);
        const v = pairVig(h, a);
        spread = { home: h, away: a, vig_free_home: v.p, overround: v.over };
      }
      if (odds.total) {
        const o = side(odds.total.over), u = side(odds.total.under);
        const v = pairVig(o, u);
        total = { over: o, under: u, vig_free_over: v.p, overround: v.over };
      }
      if (odds.moneyline) {
        const h = side(odds.moneyline.home), a = side(odds.moneyline.away);
        const v = pairVig(h, a);
        moneyline = { home: h, away: a, vig_free_home: v.p, overround: v.over };
      }
    }
    out.push({
      espn_id: String(ev.id), kickoff: ev.date, status: comp.status?.type?.state ?? ev.status?.type?.state ?? "?",
      away: espnAbbr(away), home: espnAbbr(home), name: ev.shortName ?? ev.name ?? "",
      provider: odds?.provider?.name ?? null, spread, total, moneyline,
    });
  }
  return out;
}

export async function scoreboard(startDate: string, endDate: string) {
  const d = (s: string) => s.replace(/-/g, "");
  const r = await getJson<any>(`${ESPN_SITE_BASE()}/scoreboard`, { dates: startDate === endDate ? d(startDate) : `${d(startDate)}-${d(endDate)}`, limit: "100" });
  return { games: parseScoreboard(r.data), retrieved_at: r.retrieved_at };
}

export interface PropLine {
  player: string;
  athlete_id: string | null;
  type: string;
  current: number | null;
  open: number | null;
  last_updated: string | null;
  future_timestamp: boolean;
}

const athleteCache = new Map<string, string>();

async function athleteName(ref: string): Promise<string> {
  const url = ref.replace(/^http:/, "https:").split("?")[0];
  if (athleteCache.has(url)) return athleteCache.get(url)!;
  try {
    const coreBase = ESPN_CORE_BASE();
    const target = process.env.ESPN_CORE_BASE ? url.replace(/^https:\/\/sports\.core\.api\.espn\.com\/v2\/sports\/football\/leagues\/nfl/, coreBase) : url;
    const r = await getJson<any>(target);
    const n = r.data.displayName ?? r.data.fullName ?? url;
    athleteCache.set(url, n);
    return n;
  } catch {
    return `athlete ${url.split("/").pop()}`;
  }
}

export async function propLines(espnId: string, maxItems = 2000) {
  const items: any[] = [];
  let page = 1;
  let retrieved_at = "";
  let count = 0;
  while (items.length < maxItems) {
    const r = await getJson<any>(`${ESPN_CORE_BASE()}/events/${espnId}/competitions/${espnId}/odds/100/propBets`, { limit: "500", page: String(page) });
    retrieved_at = r.retrieved_at;
    count = r.data.count ?? 0;
    items.push(...(r.data.items ?? []));
    if (!r.data.pageCount || page >= r.data.pageCount) break;
    page++;
  }
  const refs = Array.from(new Set(items.map((i) => i.athlete?.$ref).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  await mapLimit(refs.slice(0, 120), 6, async (ref) => names.set(ref, await athleteName(ref)));
  const now = Date.now();
  const seen = new Set<string>();
  const lines: PropLine[] = [];
  for (const i of items) {
    const ref = i.athlete?.$ref as string | undefined;
    const player = ref ? names.get(ref) ?? "unresolved athlete" : "team/game";
    const rec: PropLine = {
      player,
      athlete_id: ref ? ref.split("/").pop()!.split("?")[0] : null,
      type: i.type?.name ?? "?",
      current: i.current?.target?.value ?? null,
      open: i.open?.target?.value ?? null,
      last_updated: i.lastUpdated ?? null,
      future_timestamp: i.lastUpdated ? Date.parse(i.lastUpdated) > now + 5 * 60_000 : false,
    };
    const k = [rec.player, rec.type, rec.current, rec.open].join("|");
    if (seen.has(k)) continue; // ESPN repeats identical rows
    seen.add(k);
    lines.push(rec);
  }
  return { lines, total_items: count, retrieved_at, athletes_unresolved: Math.max(0, refs.length - 120) };
}

export interface InjuryRow {
  team: string;
  player: string;
  position: string | null;
  status: string | null;
  detail: string | null;
  date: string | null;
}

export async function injuries(espnId: string) {
  const r = await getJson<any>(`${ESPN_SITE_BASE()}/summary`, { event: espnId });
  const rows: InjuryRow[] = [];
  for (const t of r.data?.injuries ?? []) {
    const team = espnAbbr(t.team?.abbreviation ?? "?");
    for (const i of t.injuries ?? []) {
      rows.push({
        team,
        player: i.athlete?.displayName ?? "?",
        position: i.athlete?.position?.abbreviation ?? null,
        status: i.status ?? i.type?.description ?? null,
        detail: [i.details?.type, i.details?.detail, i.details?.side].filter(Boolean).join(" ") || null,
        date: i.date ?? null,
      });
    }
  }
  return { rows, retrieved_at: r.retrieved_at };
}

/** Shared formatting helpers. */

export const CHARACTER_LIMIT = 25000;

export function enforceCharLimit(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n…[truncated at ${CHARACTER_LIMIT} characters — narrow the request (fewer markets, a player filter, limit/offset) or use response_format='json' with pagination]`
  );
}

export function fmtOdds(o: number | null | undefined): string {
  if (o == null || Number.isNaN(o)) return "n/a";
  return o > 0 ? `+${o}` : `${o}`;
}

export function pct(p: number | null | undefined, digits = 1): string {
  if (p == null || Number.isNaN(p)) return "n/a";
  return `${(100 * p).toFixed(digits)}%`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toolText(markdown: string, structured: Record<string, unknown>, format: "markdown" | "json") {
  const text = format === "json" ? JSON.stringify(structured, null, 2) : markdown;
  return {
    content: [{ type: "text" as const, text: enforceCharLimit(text) }],
    structuredContent: structured,
  };
}

export function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

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

#!/usr/bin/env node
/**
 * nfl-market-mcp-server
 *
 * Remote MCP server (streamable HTTP, stateless JSON) exposing NFL market data from keyless public
 * sources: Kalshi's public market-data API (game, spread and total ladders, player props, price
 * history, results), DraftKings game and prop lines from ESPN's public feeds, and National Weather
 * Service stadium forecasts. Connector for the NF Agent, built on the same pattern as the
 * Parcel-GIS, FEMA and Municode connectors.
 *
 * Deploy target: Render web service (GitHub auto-deploy). No API keys.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { registerTools, TOOL_NAMES } from "./tools.js";

const VERSION = "2.0.0";

function buildServer(): McpServer {
  const server = new McpServer({ name: "nfl-market-mcp-server", version: VERSION });
  registerTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check for Render + humans.
app.get("/", (_req, res) => {
  res.json({ name: "nfl-market-mcp-server", version: VERSION, status: "ok", mcp_endpoint: "/mcp", api_keys: "none", tools: TOOL_NAMES });
});

// Stateless streamable HTTP: fresh transport + server per request, JSON responses.
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Reject non-POST on /mcp cleanly (stateless server: no GET stream, no sessions).
app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." }, id: null });
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.error(`nfl-market-mcp-server ${VERSION} listening on port ${port} (MCP endpoint: POST /mcp)`);
});

/** Kalshi public market-data client (keyless) and NFL ticker parsing. */
import { getJson, KALSHI_BASE, mapLimit, SourceError } from "./http.js";
import { GameKey, KALSHI_TEAMS, parseGameKey, seriesInfo } from "./registry.js";
import { kalshiQuote, KQuote, LadderPoint, num } from "./pricing.js";

export interface KMarket {
  ticker: string;
  event_ticker: string;
  title?: string;
  yes_sub_title?: string;
  floor_strike?: number | string | null;
  status?: string;
  result?: string;
  close_time?: string;
  occurrence_datetime?: string;
  expected_expiration_time?: string;
  [k: string]: unknown;
}

export interface KEvent {
  event_ticker: string;
  series_ticker: string;
  title?: string;
  sub_title?: string;
  markets?: KMarket[];
}

export async function listEvents(series: string, status: "open" | "closed" | "settled", maxPages = 3) {
  const events: KEvent[] = [];
  let cursor: string | undefined;
  let retrieved_at = "";
  for (let page = 0; page < maxPages; page++) {
    const r = await getJson<{ events: KEvent[]; cursor?: string }>(`${KALSHI_BASE()}/events`, {
      series_ticker: series, status, limit: "200", with_nested_markets: "true", cursor,
    });
    retrieved_at = r.retrieved_at;
    events.push(...(r.data.events ?? []));
    cursor = r.data.cursor || undefined;
    if (!cursor) break;
  }
  return { events, retrieved_at, truncated: Boolean(cursor) };
}

/** One event with markets; tolerant of both response shapes. Returns null when the event does not exist. */
export async function getEvent(eventTicker: string): Promise<{ event: KEvent; markets: KMarket[]; retrieved_at: string } | null> {
  try {
    const r = await getJson<{ event: KEvent; markets?: KMarket[] }>(`${KALSHI_BASE()}/events/${encodeURIComponent(eventTicker)}`, { with_nested_markets: "true" });
    const markets = r.data.markets ?? r.data.event?.markets ?? [];
    return { event: r.data.event, markets, retrieved_at: r.retrieved_at };
  } catch (e) {
    if (e instanceof SourceError && /HTTP 404/.test(e.message)) return null;
    throw e;
  }
}

export interface Candle {
  end: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  volume: number | null;
}

function ohlc(o: any, field: "close" | "open"): number | null {
  if (!o) return null;
  return num(o[`${field}_dollars`] ?? o[field]);
}

export async function candles(series: string, ticker: string, startTs: number, endTs: number, interval: 1 | 60 | 1440) {
  const params = { start_ts: String(startTs), end_ts: String(endTs), period_interval: String(interval) };
  let source = "live";
  let r;
  try {
    r = await getJson<{ candlesticks?: any[] }>(`${KALSHI_BASE()}/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
  } catch (e) {
    if (!(e instanceof SourceError && /HTTP 404/.test(e.message))) throw e;
    source = "historical";
    r = await getJson<{ candlesticks?: any[] }>(`${KALSHI_BASE()}/historical/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
  }
  const rows: Candle[] = (r.data.candlesticks ?? []).map((c) => {
    const bid = ohlc(c.yes_bid, "close");
    const ask = ohlc(c.yes_ask, "close");
    return {
      end: new Date(Number(c.end_period_ts) * 1000).toISOString(),
      bid, ask,
      mid: bid !== null && ask !== null && ask >= bid && bid > 0 ? (bid + ask) / 2 : null,
      last: ohlc(c.price, "close"),
      volume: num(c.volume_fp ?? c.volume),
    };
  });
  return { rows, source, retrieved_at: r.retrieved_at };
}

export async function candlesMany(items: { series: string; ticker: string }[], startTs: number, endTs: number, interval: 1 | 60 | 1440) {
  return mapLimit(items, 4, async (it) => {
    try {
      return { ...it, ...(await candles(it.series, it.ticker, startTs, endTs, interval)), error: null as string | null };
    } catch (e) {
      return { ...it, rows: [] as Candle[], source: "error", retrieved_at: "", error: (e as Error).message };
    }
  });
}

// ------------------------------------------------------------------ parsing

export function eventTickerFor(series: string, game: GameKey): string {
  return `${series.toUpperCase()}-${game.key}`;
}

export function gameKeyFromEvent(eventTicker: string): GameKey | null {
  const parts = eventTicker.split("-");
  return parts.length >= 2 ? parseGameKey(parts[1]) : null;
}

export interface ParsedMarket {
  ticker: string;
  series: string;
  kind: string;
  label: string;
  team: string | null; // nflverse abbreviation
  player: string | null;
  strike: number | null; // P(X > strike)
  threshold_label: string | null; // e.g. "1+" / "80+"
  quote: KQuote;
  status: string | null;
  result: string | null;
}

function suffixTeam(suffix: string, game: GameKey): string | null {
  const codes = [game.away_code, game.home_code].sort((a, b) => b.length - a.length);
  for (const c of codes) if (suffix.startsWith(c)) return KALSHI_TEAMS[c];
  const letters = suffix.replace(/\d+$/, "");
  return KALSHI_TEAMS[letters] ?? null;
}

export function parseMarket(m: KMarket, game: GameKey): ParsedMarket {
  const parts = m.ticker.split("-");
  const series = parts[0];
  const info = seriesInfo(series);
  const kind = info?.kind ?? "unknown";
  const strike = num(m.floor_strike);
  const title = String(m.title ?? m.yes_sub_title ?? "");
  let team: string | null = null;
  let player: string | null = null;
  let threshold: string | null = null;
  if (kind === "game_winner") team = suffixTeam(parts[2] ?? "", game);
  else if (kind === "spread_ladder") team = suffixTeam(parts[2] ?? "", game);
  else if (kind === "player_threshold") {
    team = suffixTeam(parts[2] ?? "", game);
    player = title.includes(":") ? title.split(":")[0].trim() : (m.yes_sub_title ?? "").split(":")[0].trim() || null;
    threshold = strike !== null ? `${Math.round(strike + 0.5)}+` : null;
  }
  return {
    ticker: m.ticker, series, kind, label: title, team, player, strike, threshold_label: threshold,
    quote: kalshiQuote(m), status: (m.status as string) ?? null, result: (m.result as string) || null,
  };
}

export function ladder(markets: ParsedMarket[], filter: (m: ParsedMarket) => boolean): LadderPoint[] {
  return markets
    .filter((m) => filter(m) && m.strike !== null && m.quote.mid !== null)
    .map((m) => ({ strike: m.strike as number, p: m.quote.mid as number, ticker: m.ticker, thin: m.quote.thin }));
}

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

/**
 * Price math.
 *  - Sportsbook American odds: implied probability, payout, two-way vig removal.
 *  - Kalshi binary markets: mid-price as probability, spread width, thin-market flags.
 *  - Kalshi ladders ("wins by over 3.5", "80+ receiving yards"): monotone clean-up (isotonic),
 *    probability at a sportsbook line (exact strike or interpolated, flagged), and exact
 *    win/push/loss for whole-number lines using the neighbouring half-point strikes.
 * Nothing is estimated beyond what the prices imply; every derived number says how it was derived.
 */
import { THIN_MARKET } from "./registry.js";

export function implied(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

export function payout(odds: number): number {
  return odds < 0 ? 100 / -odds : odds / 100;
}

export function fairAmerican(p: number | null | undefined): number | null {
  if (p == null || !(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

export function devigPair(a: number, b: number): { pa: number; pb: number; overround: number } {
  const ia = implied(a);
  const ib = implied(b);
  return { pa: ia / (ia + ib), pb: ib / (ia + ib), overround: ia + ib - 1 };
}

export function parseAmerican(s: unknown): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  if (typeof s !== "string") return null;
  const t = s.trim().toUpperCase();
  if (t === "EVEN" || t === "EV") return 100;
  const n = Number(t.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
}

export function parseLine(s: unknown): number | null {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const n = Number(s.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- Kalshi quotes

export interface KQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  mid: number | null;
  width: number | null;
  volume: number | null;
  thin: boolean;
  note: string | null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accepts both the current "*_dollars" string fields and legacy integer-cent fields. */
export function kalshiQuote(m: Record<string, unknown>): KQuote {
  const d = (k: string) => {
    const dollars = num(m[`${k}_dollars`]);
    if (dollars !== null) return dollars;
    const cents = num(m[k]);
    return cents === null ? null : cents / 100;
  };
  const bid = d("yes_bid");
  const ask = d("yes_ask");
  const last = d("last_price");
  const volume = num(m.volume_fp ?? m.volume);
  let mid: number | null = null;
  let note: string | null = null;
  if (bid !== null && ask !== null && bid > 0 && ask < 1 && ask >= bid) mid = (bid + ask) / 2;
  else if (bid !== null && ask !== null && bid === 0 && ask > 0) {
    mid = ask / 2;
    note = "no bid — mid set to half the ask (low-confidence)";
  } else note = "no two-sided quote";
  const width = bid !== null && ask !== null ? ask - bid : null;
  const thin = width === null || width > THIN_MARKET.maxSpread || (volume ?? 0) < THIN_MARKET.minVolume;
  return { bid, ask, last, mid, width, volume, thin, note };
}

// ---------------------------------------------------------------- ladders

export interface LadderPoint {
  strike: number; // P(X > strike)
  p: number;
  ticker?: string;
  thin?: boolean;
}

/** Pool-adjacent-violators: make P(X > s) non-increasing in s. */
export function isotonicDecreasing(points: LadderPoint[]): LadderPoint[] {
  const pts = [...points].sort((a, b) => a.strike - b.strike);
  const blocks: { sum: number; n: number; idx: number[] }[] = [];
  pts.forEach((pt, i) => {
    blocks.push({ sum: pt.p, n: 1, idx: [i] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n >= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n, idx: [...a.idx, ...b.idx] });
    }
  });
  const out = pts.map((p) => ({ ...p }));
  for (const b of blocks) for (const i of b.idx) out[i].p = b.sum / b.n;
  return out;
}

export interface LadderRead {
  p: number | null;
  method: "exact_strike" | "interpolated" | "outside_ladder" | "empty";
  lower?: number;
  upper?: number;
}

/** P(X > x) from a cleaned ladder. */
export function ladderAt(ladder: LadderPoint[], x: number): LadderRead {
  if (!ladder.length) return { p: null, method: "empty" };
  const pts = isotonicDecreasing(ladder);
  const hit = pts.find((p) => Math.abs(p.strike - x) < 1e-9);
  if (hit) return { p: hit.p, method: "exact_strike" };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.strike < x && x < b.strike) {
      const t = (x - a.strike) / (b.strike - a.strike);
      return { p: a.p + t * (b.p - a.p), method: "interpolated", lower: a.strike, upper: b.strike };
    }
  }
  return { p: null, method: "outside_ladder", lower: pts[0].strike, upper: pts[pts.length - 1].strike };
}

export interface ThreeWay {
  p_win: number | null;
  p_push: number | null;
  p_loss: number | null;
  method: string;
}

/**
 * Over/under a sportsbook line from an "X > strike" ladder of an integer-valued stat.
 * Half-point line: over = P(X > L). Whole-number line: over = P(X > L+0.5), push = P(X > L-0.5) - P(X > L+0.5).
 */
export function overFromLadder(ladder: LadderPoint[], line: number): ThreeWay {
  const whole = Number.isInteger(line);
  if (!whole) {
    const r = ladderAt(ladder, line);
    return { p_win: r.p, p_push: r.p === null ? null : 0, p_loss: r.p === null ? null : 1 - r.p, method: r.method };
  }
  const hi = ladderAt(ladder, line + 0.5);
  const lo = ladderAt(ladder, line - 0.5);
  if (hi.p === null || lo.p === null) return { p_win: null, p_push: null, p_loss: null, method: "outside_ladder" };
  const push = Math.max(0, lo.p - hi.p);
  const method = hi.method === "exact_strike" && lo.method === "exact_strike" ? "exact_strikes (whole-number line)" : "interpolated (whole-number line)";
  return { p_win: hi.p, p_push: push, p_loss: 1 - hi.p - push, method };
}

/**
 * Home spread cover from the two "team wins by over s" ladders.
 * homeLine is the betting line for the home side (-4.5 = home favored by 4.5).
 * Home covers when home margin > -homeLine.
 */
export function spreadFromLadders(home: LadderPoint[], away: LadderPoint[], homeLine: number, homeWin: number | null): ThreeWay {
  const h = -homeLine;
  if (h > 0) {
    const r = overFromLadder(home, h);
    return { ...r, method: `home ladder: ${r.method}` };
  }
  if (h < 0) {
    // home margin > -a  <=>  away margin < a
    const a = -h;
    const r = overFromLadder(away, a); // P(away margin > a), push at a
    if (r.p_win === null) return { p_win: null, p_push: null, p_loss: null, method: `away ladder: ${r.method}` };
    return { p_win: r.p_loss, p_push: r.p_push, p_loss: r.p_win, method: `away ladder (complement): ${r.method}` };
  }
  return { p_win: homeWin, p_push: null, p_loss: homeWin === null ? null : 1 - homeWin, method: "pick'em: winner market (tie probability not separated)" };
}

/**
 * Registry for nfl-market-mcp-server (keyless).
 *
 * Coverage grows by adding an entry here, not by writing code — the same pattern as
 * Parcel-GIS-mcp. `verified` is the date an entry was last confirmed live, or false
 * (⟨verify at run⟩).
 */

export interface Source {
  id: string;
  name: string;
  kind: "official_public_api" | "unofficial_public_feed" | "government_api";
  base: string;
  what: string;
  caveats: string;
  verified: string | false;
}

export const SOURCES: Source[] = [
  {
    id: "kalshi",
    name: "Kalshi public market data API",
    kind: "official_public_api",
    base: "https://api.elections.kalshi.com/trade-api/v2",
    what: "Exchange prices (bid/ask/last, volume) for NFL game winner, spread and total ladders, and player threshold markets (anytime TD, yards, receptions, attempts); settled results; hourly/minute price history (candlesticks).",
    caveats: "A prediction-market exchange, not one of the user's sportsbooks: use as the market probability (p_market) and for line history, never as a bettable price. Mid-price excludes Kalshi trading fees. Thin markets (wide bid/ask, low volume) are flagged. Player TD markets (KXNFLTD) appear to start with the 2026 season, so free prop price history is short.",
    verified: "2026-09-16",
  },
  {
    id: "espn_site",
    name: "ESPN public scoreboard / summary feed (DraftKings odds)",
    kind: "unofficial_public_feed",
    base: "https://site.api.espn.com/apis/site/v2/sports/football/nfl",
    what: "DraftKings spread, total and moneyline — opening and current prices — for each game; ESPN event ids; injury lists.",
    caveats: "Undocumented feed: may change without notice. No per-price timestamp — the server's retrieved_at is the only time. ESPN labels the current price 'close' even before kickoff. On 2026-09-16 the core odds endpoint and summary 'pickcenter' still showed the opening line while the scoreboard showed the live line, so this server reads game lines from the scoreboard only.",
    verified: "2026-09-16",
  },
  {
    id: "espn_core",
    name: "ESPN core API — DraftKings prop lines",
    kind: "unofficial_public_feed",
    base: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl",
    what: "DraftKings player prop LINES (open and current target, e.g. passing yards 266.5) with lastUpdated.",
    caveats: "Lines only — no prices (juice) are published, so no break-even or vig-free probability can be computed from this source. lastUpdated values have been seen later than server time; they are reported as given and flagged.",
    verified: "2026-09-16",
  },
  {
    id: "nws",
    name: "National Weather Service API",
    kind: "government_api",
    base: "https://api.weather.gov",
    what: "Hourly forecast (temperature, wind, precipitation chance) and gridded wind gusts at a stadium.",
    caveats: "US only, about 7 days ahead.",
    verified: false,
  },
];

export type SeriesKind = "game_winner" | "spread_ladder" | "total_ladder" | "player_threshold";

export interface KalshiSeries {
  ticker: string;
  label: string;
  kind: SeriesKind;
  stat?: string;
  verified: string | false;
}

export const KALSHI_SERIES: KalshiSeries[] = [
  { ticker: "KXNFLGAME", label: "Game winner", kind: "game_winner", verified: "2026-09-16" },
  { ticker: "KXNFLSPREAD", label: "Winning margin ladder (spread)", kind: "spread_ladder", verified: "2026-09-16" },
  { ticker: "KXNFLTOTAL", label: "Total points ladder", kind: "total_ladder", verified: "2026-09-16" },
  { ticker: "KXNFLTD", label: "Player touchdowns (1+ = anytime TD)", kind: "player_threshold", stat: "touchdowns", verified: "2026-09-16" },
  { ticker: "KXNFLRECYDS", label: "Player receiving yards", kind: "player_threshold", stat: "receiving_yards", verified: "2026-09-16" },
  { ticker: "KXNFLRSHYDS", label: "Player rushing yards", kind: "player_threshold", stat: "rushing_yards", verified: "2026-09-16" },
  { ticker: "KXNFLPASSYDS", label: "Player passing yards", kind: "player_threshold", stat: "passing_yards", verified: "2026-09-16" },
  { ticker: "KXNFLREC", label: "Player receptions", kind: "player_threshold", stat: "receptions", verified: "2026-09-16" },
  { ticker: "KXNFLRSHATT", label: "Player rush attempts", kind: "player_threshold", stat: "rush_attempts", verified: false },
  { ticker: "KXNFLPASSATT", label: "Player pass attempts", kind: "player_threshold", stat: "pass_attempts", verified: false },
  { ticker: "KXNFLPASSCOMP", label: "Player pass completions", kind: "player_threshold", stat: "pass_completions", verified: false },
  { ticker: "KXNFLRRYDS", label: "Player rushing + receiving yards", kind: "player_threshold", stat: "rush_rec_yards", verified: false },
];

export const PLAYER_SERIES = KALSHI_SERIES.filter((s) => s.kind === "player_threshold").map((s) => s.ticker);

export function seriesInfo(ticker: string): KalshiSeries | undefined {
  return KALSHI_SERIES.find((s) => s.ticker === ticker.toUpperCase());
}

/** Kalshi team codes seen in tickers -> nflverse abbreviations. */
export const KALSHI_TEAMS: Record<string, string> = {
  ARI: "ARI", ATL: "ATL", BAL: "BAL", BUF: "BUF", CAR: "CAR", CHI: "CHI", CIN: "CIN", CLE: "CLE",
  DAL: "DAL", DEN: "DEN", DET: "DET", GB: "GB", HOU: "HOU", IND: "IND", JAC: "JAX", JAX: "JAX",
  KC: "KC", LV: "LV", LAC: "LAC", LAR: "LA", LA: "LA", MIA: "MIA", MIN: "MIN", NE: "NE", NO: "NO",
  NYG: "NYG", NYJ: "NYJ", PHI: "PHI", PIT: "PIT", SF: "SF", SEA: "SEA", TB: "TB", TEN: "TEN",
  WAS: "WAS", WSH: "WAS",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface GameKey {
  key: string; // e.g. 26SEP17DETBUF
  date: string; // 2026-09-17 (Kalshi's scheduled date, US)
  away_code: string;
  home_code: string;
  away: string;
  home: string;
}

/** Parse "26SEP17DETBUF" (away first, home second). */
export function parseGameKey(key: string): GameKey | null {
  const m = /^(\d{2})([A-Z]{3})(\d{2})([A-Z]{4,6})$/.exec(key.toUpperCase());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2]);
  if (mi < 0) return null;
  const teams = m[4];
  for (let i = 2; i <= 3; i++) {
    const a = teams.slice(0, i);
    const h = teams.slice(i);
    if (KALSHI_TEAMS[a] && KALSHI_TEAMS[h]) {
      return {
        key: m[0], date: `20${m[1]}-${String(mi + 1).padStart(2, "0")}-${m[3]}`,
        away_code: a, home_code: h, away: KALSHI_TEAMS[a], home: KALSHI_TEAMS[h],
      };
    }
  }
  return null;
}

/** ESPN abbreviations -> nflverse abbreviations. */
export function espnAbbr(a: string): string {
  const u = a.toUpperCase();
  return u === "WSH" ? "WAS" : u === "LAR" ? "LA" : u === "JAC" ? "JAX" : u;
}

export interface Stadium {
  team: string;
  name: string;
  lat: number;
  lon: number;
  roof: "outdoor" | "dome" | "retractable" | "fixed_canopy";
  elevation_ft?: number;
  note?: string;
  verified: string | false;
}

/** Home stadiums. Coordinates are approximate (well inside one NWS 2.5 km grid cell). */
export const STADIUMS: Stadium[] = [
  { team: "ARI", name: "State Farm Stadium", lat: 33.5276, lon: -112.2626, roof: "retractable", verified: false },
  { team: "ATL", name: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.4008, roof: "retractable", verified: false },
  { team: "BAL", name: "M&T Bank Stadium", lat: 39.278, lon: -76.6227, roof: "outdoor", verified: false },
  { team: "BUF", name: "Highmark Stadium (new, opened 2026)", lat: 42.772, lon: -78.786, roof: "outdoor", note: "New venue: no weather/scoring history. Partial canopy over seats, open field.", verified: false },
  { team: "CAR", name: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, roof: "outdoor", verified: false },
  { team: "CHI", name: "Soldier Field", lat: 41.8623, lon: -87.6167, roof: "outdoor", note: "Lakefront — wind-exposed.", verified: false },
  { team: "CIN", name: "Paycor Stadium", lat: 39.0955, lon: -84.5161, roof: "outdoor", verified: false },
  { team: "CLE", name: "Huntington Bank Field", lat: 41.5061, lon: -81.6995, roof: "outdoor", note: "Lakefront — wind-exposed.", verified: false },
  { team: "DAL", name: "AT&T Stadium", lat: 32.7473, lon: -97.0945, roof: "retractable", verified: false },
  { team: "DEN", name: "Empower Field at Mile High", lat: 39.7439, lon: -105.0201, roof: "outdoor", elevation_ft: 5280, note: "Altitude.", verified: false },
  { team: "DET", name: "Ford Field", lat: 42.34, lon: -83.0456, roof: "dome", verified: false },
  { team: "GB", name: "Lambeau Field", lat: 44.5013, lon: -88.0622, roof: "outdoor", verified: false },
  { team: "HOU", name: "NRG Stadium", lat: 29.6847, lon: -95.4107, roof: "retractable", verified: false },
  { team: "IND", name: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, roof: "retractable", verified: false },
  { team: "JAX", name: "EverBank Stadium", lat: 30.3239, lon: -81.6373, roof: "outdoor", verified: false },
  { team: "KC", name: "GEHA Field at Arrowhead Stadium", lat: 39.0489, lon: -94.4839, roof: "outdoor", verified: false },
  { team: "LV", name: "Allegiant Stadium", lat: 36.0909, lon: -115.1833, roof: "dome", verified: false },
  { team: "LAC", name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, roof: "fixed_canopy", note: "Covered by a fixed translucent roof — treat as indoor.", verified: false },
  { team: "LA", name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, roof: "fixed_canopy", note: "Covered by a fixed translucent roof — treat as indoor.", verified: false },
  { team: "MIA", name: "Hard Rock Stadium", lat: 25.958, lon: -80.2389, roof: "outdoor", note: "Canopy over seats, open field.", verified: false },
  { team: "MIN", name: "U.S. Bank Stadium", lat: 44.9737, lon: -93.2575, roof: "dome", verified: false },
  { team: "NE", name: "Gillette Stadium", lat: 42.0909, lon: -71.2643, roof: "outdoor", verified: false },
  { team: "NO", name: "Caesars Superdome", lat: 29.9511, lon: -90.0812, roof: "dome", verified: false },
  { team: "NYG", name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, roof: "outdoor", verified: false },
  { team: "NYJ", name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, roof: "outdoor", verified: false },
  { team: "PHI", name: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, roof: "outdoor", verified: false },
  { team: "PIT", name: "Acrisure Stadium", lat: 40.4468, lon: -80.0158, roof: "outdoor", verified: false },
  { team: "SF", name: "Levi's Stadium", lat: 37.403, lon: -121.97, roof: "outdoor", verified: false },
  { team: "SEA", name: "Lumen Field", lat: 47.5952, lon: -122.3316, roof: "outdoor", verified: false },
  { team: "TB", name: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, roof: "outdoor", verified: false },
  { team: "TEN", name: "Nissan Stadium", lat: 36.1665, lon: -86.7713, roof: "outdoor", verified: false },
  { team: "WAS", name: "Northwest Stadium", lat: 38.9076, lon: -76.8645, roof: "outdoor", verified: false },
];

export function stadiumFor(team: string): Stadium | undefined {
  const t = espnAbbr(team);
  return STADIUMS.find((s) => s.team === t);
}

export const THIN_MARKET = { maxSpread: 0.04, minVolume: 1000 };

/**
 * Tool registrations for nfl-market-mcp-server (keyless).
 *
 * Honesty rules (NF Agent doctrine), enforced in code and repeated in descriptions:
 *  - Kalshi is an exchange, not one of the user's books: its prices are a market probability
 *    and line-history source, never a bettable price.
 *  - DraftKings prices come from ESPN's public scoreboard with no per-price timestamp; the
 *    server's retrieved_at is reported. FanDuel and Fanatics have no free keyless source —
 *    those prices must be pasted by the user (otherwise NO PRICE).
 *  - DraftKings prop LINES from ESPN carry no prices — no break-even can be computed from them.
 *  - Ladder reads say whether they hit an exact strike or were interpolated; lines outside a
 *    ladder return null, never an extrapolation. Thin Kalshi markets are flagged.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson, SourceError } from "./http.js";
import {
  candles, candlesMany, eventTickerFor, gameKeyFromEvent, getEvent, ladder, listEvents, ParsedMarket, parseMarket,
} from "./kalshi.js";
import { injuries, propLines, scoreboard } from "./espn.js";
import {
  GameKey, KALSHI_SERIES, KALSHI_TEAMS, parseGameKey, PLAYER_SERIES, seriesInfo, SOURCES, STADIUMS, stadiumFor, THIN_MARKET,
} from "./registry.js";
import { fairAmerican, overFromLadder, spreadFromLadders, ThreeWay } from "./pricing.js";
import { fmtOdds, pct, toolError, toolText } from "./format.js";
import { kickoffForecast } from "./nws.js";

const responseFormat = z.enum(["markdown", "json"]).default("markdown").describe("'markdown' (default) or 'json'");
const gameArg = z.string().describe("Kalshi game key like 26SEP17DETBUF, or AWAY@HOME like DET@BUF (nflverse abbreviations)");
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const isoDate = z.string().describe("ISO 8601 timestamp, e.g. 2026-09-20T17:00:00Z");

function errorResult(e: unknown) {
  const msg = e instanceof SourceError ? e.message : `Unexpected error: ${(e as Error).message}`;
  return toolError(msg);
}

function toCode(abbr: string): string[] {
  const a = abbr.toUpperCase() === "LAR" ? "LA" : abbr.toUpperCase() === "JAC" ? "JAX" : abbr.toUpperCase();
  return Object.entries(KALSHI_TEAMS).filter(([, v]) => v === a).map(([k]) => k);
}

/** Resolve a game argument to a Kalshi game key. */
async function resolveGame(game: string, date?: string): Promise<GameKey> {
  const direct = parseGameKey(game.replace(/^KXNFL[A-Z]*-/, ""));
  if (direct) return direct;
  const m = /^([A-Za-z]{2,3})\s*@\s*([A-Za-z]{2,3})$/.exec(game.trim());
  if (!m) throw new SourceError(`Can't read game '${game}'. Use a Kalshi key (26SEP17DETBUF) or AWAY@HOME (DET@BUF).`);
  const away = toCode(m[1]);
  const home = toCode(m[2]);
  const want = (k: GameKey) => away.includes(k.away_code) && home.includes(k.home_code) && (!date || k.date === date);
  for (const status of ["open", "settled"] as const) {
    const { events } = await listEvents("KXNFLGAME", status, status === "open" ? 2 : 6);
    const keys = events.map((e) => gameKeyFromEvent(e.event_ticker)).filter((k): k is GameKey => Boolean(k) && want(k as GameKey));
    if (keys.length) {
      keys.sort((a, b) => a.date.localeCompare(b.date));
      return status === "open" ? keys[0] : keys[keys.length - 1];
    }
  }
  throw new SourceError(`No Kalshi game found for ${game}${date ? ` on ${date}` : ""}. Try kalshi_list_games, or pass the key directly.`);
}

async function loadSeries(game: GameKey, series: string[]) {
  const out: { series: string; exists: boolean; markets: ParsedMarket[]; retrieved_at: string }[] = [];
  for (const s of series) {
    const ev = await getEvent(eventTickerFor(s, game));
    out.push({ series: s, exists: Boolean(ev), markets: ev ? ev.markets.map((m) => parseMarket(m, game)) : [], retrieved_at: ev?.retrieved_at ?? "" });
  }
  return out;
}

function quoteCells(m: ParsedMarket): string {
  const q = m.quote;
  return `${q.bid?.toFixed(2) ?? "-"} / ${q.ask?.toFixed(2) ?? "-"} | ${pct(q.mid)} | ${fmtOdds(fairAmerican(q.mid))} | ${q.volume === null ? "-" : Math.round(q.volume)}${q.thin ? " ⚠thin" : ""}`;
}

function threeWayText(t: ThreeWay): string {
  if (t.p_win === null) return `n/a (${t.method})`;
  return `win ${pct(t.p_win)} · push ${pct(t.p_push)} · loss ${pct(t.p_loss)} — ${t.method}`;
}

function seriesArray(input?: string[]): string[] {
  const list = (input?.length ? input : PLAYER_SERIES.filter((s) => seriesInfo(s)?.verified)).map((s) => s.toUpperCase());
  const bad = list.filter((s) => !seriesInfo(s));
  if (bad.length) throw new SourceError(`Unknown series: ${bad.join(", ")}. See market_sources_list.`);
  return list;
}

export const TOOL_NAMES = [
  "market_sources_list", "kalshi_list_games", "kalshi_game_markets", "kalshi_player_props", "kalshi_line_probability",
  "kalshi_price_history", "kalshi_closing_prices", "kalshi_settled_results", "espn_dk_game_lines", "espn_dk_prop_lines",
  "espn_injuries", "market_raw_get", "wx_game_forecast",
];

export function registerTools(server: McpServer): void {
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

  // ------------------------------------------------------------------ registry
  server.registerTool(
    "market_sources_list",
    {
      title: "List sources, Kalshi series, team codes and stadiums",
      description:
        "Show every source this server uses (all keyless) with what it provides, its caveats and verification date; the Kalshi NFL series tickers (game winner, spread/total ladders, player props) with verification status; Kalshi↔nflverse team codes; and home stadiums with roof type. No network call. Call this first.",
      inputSchema: { section: z.enum(["all", "sources", "series", "teams", "stadiums"]).default("all"), response_format: responseFormat },
      annotations: { ...ro, openWorldHint: false },
    },
    async ({ section, response_format }) => {
      const md: string[] = ["# nfl-market-mcp sources (no API keys)"];
      if (section === "all" || section === "sources") {
        md.push("\n## Sources", ...SOURCES.map((s) => `- **${s.name}** (${s.kind}; ${s.verified ? `verified ${s.verified}` : "⟨verify at run⟩"})\n  - Provides: ${s.what}\n  - Caveats: ${s.caveats}`),
          "\nFanDuel and Fanatics: no free keyless source — paste their prices (book, line, price, time seen) or treat as NO PRICE.");
      }
      if (section === "all" || section === "series") {
        md.push("\n## Kalshi NFL series", "| Ticker | Covers | Kind | Verified |", "|---|---|---|---|",
          ...KALSHI_SERIES.map((s) => `| \`${s.ticker}\` | ${s.label} | ${s.kind} | ${s.verified || "⟨verify at run⟩"} |`),
          `\nThin-market flag: bid/ask wider than ${THIN_MARKET.maxSpread * 100}¢ or volume under ${THIN_MARKET.minVolume}.`);
      }
      if (section === "all" || section === "teams") {
        md.push("\n## Kalshi team codes → nflverse", Object.entries(KALSHI_TEAMS).map(([k, v]) => (k === v ? k : `${k}→${v}`)).join(", "));
      }
      if (section === "all" || section === "stadiums") {
        md.push("\n## Stadiums", ...STADIUMS.map((s) => `- ${s.team}: ${s.name} (${s.roof}) ${s.lat}, ${s.lon}${s.note ? ` — ${s.note}` : ""} [${s.verified ? `verified ${s.verified}` : "coordinates ⟨verify at run⟩"}]`));
      }
      return toolText(md.join("\n"), { sources: SOURCES, series: KALSHI_SERIES, teams: KALSHI_TEAMS, stadiums: STADIUMS }, response_format);
    }
  );

  // ------------------------------------------------------------------ games
  server.registerTool(
    "kalshi_list_games",
    {
      title: "List NFL games on Kalshi with win probabilities",
      description:
        "List open (or settled) Kalshi NFL game-winner events: game key (e.g. 26SEP17DETBUF, used by the other kalshi_* tools), date, teams (nflverse abbreviations), and each side's bid/ask/mid win probability with the no-vig normalised pair and fair American odds. Optional date window.",
      inputSchema: {
        status: z.enum(["open", "settled"]).default("open"),
        date_from: dateArg.optional(),
        date_to: dateArg.optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ status, date_from, date_to, response_format }) => {
      try {
        const { events, retrieved_at, truncated } = await listEvents("KXNFLGAME", status, status === "open" ? 2 : 4);
        const games = [];
        for (const e of events) {
          const g = gameKeyFromEvent(e.event_ticker);
          if (!g) continue;
          if (date_from && g.date < date_from) continue;
          if (date_to && g.date > date_to) continue;
          const ms = (e.markets ?? []).map((m) => parseMarket(m, g));
          const h = ms.find((m) => m.team === g.home);
          const a = ms.find((m) => m.team === g.away);
          const sum = (h?.quote.mid ?? NaN) + (a?.quote.mid ?? NaN);
          games.push({
            key: g.key, date: g.date, away: g.away, home: g.home,
            home_mid: h?.quote.mid ?? null, away_mid: a?.quote.mid ?? null,
            home_novig: Number.isFinite(sum) ? (h!.quote.mid as number) / sum : null,
            home_thin: h?.quote.thin ?? null,
            result: h?.result || a?.result ? { home: h?.result ?? null, away: a?.result ?? null } : null,
          });
        }
        games.sort((x, y) => x.date.localeCompare(y.date));
        const md = [`# Kalshi NFL games (${status}) — retrieved ${retrieved_at}`, truncated ? "(more pages exist — narrow the date window)" : "",
          "| Date | Game | Key | Home win (mid) | Home no-vig | Fair home / away |", "|---|---|---|---|---|---|",
          ...games.map((g) => `| ${g.date} | ${g.away} @ ${g.home} | \`${g.key}\` | ${pct(g.home_mid)}${g.home_thin ? " ⚠" : ""} | ${pct(g.home_novig)} | ${fmtOdds(fairAmerican(g.home_novig))} / ${fmtOdds(fairAmerican(g.home_novig === null ? null : 1 - g.home_novig))} |`)];
        return toolText(md.join("\n"), { retrieved_at, status, games }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "kalshi_game_markets",
    {
      title: "Kalshi winner, spread ladder and total ladder for one game",
      description:
        "For one game: winner prices, the 'team wins by over X' ladder for both teams and the 'over X points' ladder, each rung with bid/ask, mid probability, fair odds and volume (thin rungs flagged). Pass home_spread (the home side's betting line, e.g. -4.5) and/or total_line (e.g. 54.5) to get the market's win/push/loss probability at a sportsbook's number — exact when the line is a Kalshi strike, interpolated otherwise (flagged), and exact win/push/loss for whole-number lines using the neighbouring half-point strikes.",
      inputSchema: {
        game: gameArg,
        date: dateArg.optional().describe("Needed only with AWAY@HOME for past games"),
        home_spread: z.number().min(-40).max(40).optional(),
        total_line: z.number().min(10).max(100).optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ game, date, home_spread, total_line, response_format }) => {
      try {
        const g = await resolveGame(game, date);
        const [win, spr, tot] = await loadSeries(g, ["KXNFLGAME", "KXNFLSPREAD", "KXNFLTOTAL"]);
        const h = win.markets.find((m) => m.team === g.home);
        const a = win.markets.find((m) => m.team === g.away);
        const sum = (h?.quote.mid ?? NaN) + (a?.quote.mid ?? NaN);
        const homeWin = Number.isFinite(sum) ? (h!.quote.mid as number) / sum : null;
        const homeLadder = ladder(spr.markets, (m) => m.team === g.home);
        const awayLadder = ladder(spr.markets, (m) => m.team === g.away);
        const totLadder = ladder(tot.markets, () => true);
        const derived: Record<string, unknown> = {};
        const md: string[] = [`# Kalshi — ${g.away} @ ${g.home} (${g.date}) \`${g.key}\``, `Retrieved ${win.retrieved_at || spr.retrieved_at}. Kalshi is a price reference, not a sportsbook.`];
        md.push("\n## Winner", "| Side | bid / ask | mid | fair | volume |", "|---|---|---|---|---|",
          ...[a, h].filter(Boolean).map((m) => `| ${m!.team} | ${quoteCells(m!)} |`),
          `No-vig home win: ${pct(homeWin)} (fair ${fmtOdds(fairAmerican(homeWin))}).`);
        if (home_spread !== undefined) {
          const t = spreadFromLadders(homeLadder, awayLadder, home_spread, homeWin);
          derived.spread = { home_line: home_spread, ...t };
          md.push(`\n**${g.home} ${home_spread > 0 ? "+" : ""}${home_spread}:** ${threeWayText(t)}`);
        }
        if (total_line !== undefined) {
          const t = overFromLadder(totLadder, total_line);
          derived.total = { line: total_line, over: t.p_win, push: t.p_push, under: t.p_loss, method: t.method };
          md.push(`**Total ${total_line} (over):** ${threeWayText(t)}`);
        }
        for (const [title, list] of [["Spread ladder (team wins by over X)", spr], ["Total ladder (over X points)", tot]] as const) {
          md.push(`\n## ${title}`);
          if (!list.exists) {
            md.push("Kalshi has not listed this market for the game.");
            continue;
          }
          md.push("| Rung | bid / ask | mid | fair | volume |", "|---|---|---|---|---|",
            ...[...list.markets].sort((x, y) => (x.team ?? "").localeCompare(y.team ?? "") || (x.strike ?? 0) - (y.strike ?? 0))
              .map((m) => `| ${m.team ? `${m.team} by > ` : "> "}${m.strike} | ${quoteCells(m)} |`));
        }
        return toolText(md.join("\n"), {
          game: g, home_win_novig: homeWin, winner: [a, h].filter(Boolean), derived,
          spread_ladder: { home: homeLadder, away: awayLadder, exists: spr.exists }, total_ladder: { rungs: totLadder, exists: tot.exists },
        }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // ------------------------------------------------------------------ player props
  server.registerTool(
    "kalshi_player_props",
    {
      title: "Kalshi player prop ladders for one game",
      description:
        "Player threshold markets for one game — anytime TD (KXNFLTD, '1+'), receiving/rushing/passing yards, receptions (and attempts where listed) — grouped by player, each rung with bid/ask, mid probability, fair odds and volume. Filter by player substring and series. Default: all verified player series. For the market probability at a specific sportsbook line use kalshi_line_probability.",
      inputSchema: {
        game: gameArg,
        date: dateArg.optional(),
        series: z.array(z.string()).max(8).optional().describe("e.g. ['KXNFLTD','KXNFLRECYDS']"),
        player: z.string().optional(),
        hide_thin: z.boolean().default(false),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ game, date, series, player, hide_thin, response_format }) => {
      try {
        const g = await resolveGame(game, date);
        const list = await loadSeries(g, seriesArray(series));
        const md: string[] = [`# Kalshi player props — ${g.away} @ ${g.home} (${g.date})`, "Mid = market probability (fees excluded). ⚠ = thin market."];
        const out: Record<string, unknown>[] = [];
        for (const s of list) {
          const info = seriesInfo(s.series)!;
          let ms = s.markets;
          if (player) ms = ms.filter((m) => (m.player ?? "").toLowerCase().includes(player.toLowerCase()));
          if (hide_thin) ms = ms.filter((m) => !m.quote.thin);
          md.push(`\n## ${info.label} (\`${s.series}\`)`);
          if (!s.exists) {
            md.push("Not listed for this game.");
            continue;
          }
          if (!ms.length) {
            md.push("No matching markets.");
            continue;
          }
          md.push("| Player | Team | Threshold | bid / ask | mid | fair | volume |", "|---|---|---|---|---|---|---|",
            ...[...ms].sort((x, y) => (x.player ?? "").localeCompare(y.player ?? "") || (x.strike ?? 0) - (y.strike ?? 0))
              .map((m) => `| ${m.player} | ${m.team ?? "?"} | ${m.threshold_label} | ${quoteCells(m)} |`));
          out.push(...ms.map((m) => ({ series: s.series, stat: info.stat, ticker: m.ticker, player: m.player, team: m.team, strike: m.strike, threshold: m.threshold_label, ...m.quote, status: m.status, result: m.result })));
        }
        return toolText(md.join("\n"), { game: g, markets: out }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "kalshi_line_probability",
    {
      title: "Market probability at a sportsbook's line",
      description:
        "Turn a Kalshi ladder into the market's win/push/loss probability at the exact line a sportsbook is offering — the p_market input for the NF Agent. market='spread' (line = home side's line, e.g. -4.5), 'total' (line = total), 'moneyline' (no line), or a player series ticker with player and line (e.g. KXNFLRECYDS, 'St. Brown', 74.5; KXNFLTD with line 0.5 = anytime TD). Returns the method (exact strike / interpolated / whole-number line from neighbouring strikes) and the rungs used; lines outside the ladder return null.",
      inputSchema: {
        game: gameArg,
        date: dateArg.optional(),
        market: z.string().describe("'spread' | 'total' | 'moneyline' | a player series ticker"),
        line: z.number().optional(),
        player: z.string().optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ game, date, market, line, player, response_format }) => {
      try {
        const g = await resolveGame(game, date);
        const mk = market.toLowerCase();
        let result: ThreeWay;
        let used: unknown[] = [];
        let label = "";
        if (mk === "moneyline" || mk === "spread") {
          const [win, spr] = await loadSeries(g, mk === "spread" ? ["KXNFLGAME", "KXNFLSPREAD"] : ["KXNFLGAME"]);
          const h = win.markets.find((m) => m.team === g.home);
          const a = win.markets.find((m) => m.team === g.away);
          const sum = (h?.quote.mid ?? NaN) + (a?.quote.mid ?? NaN);
          const homeWin = Number.isFinite(sum) ? (h!.quote.mid as number) / sum : null;
          if (mk === "moneyline") {
            result = { p_win: homeWin, p_push: null, p_loss: homeWin === null ? null : 1 - homeWin, method: "winner market, normalised (home side)" };
            label = `${g.home} moneyline`;
          } else {
            if (line === undefined) return toolError("Pass line = the home side's spread, e.g. -4.5.");
            const hl = ladder(spr!.markets, (m) => m.team === g.home);
            const al = ladder(spr!.markets, (m) => m.team === g.away);
            result = spreadFromLadders(hl, al, line, homeWin);
            used = [...hl, ...al];
            label = `${g.home} ${line > 0 ? "+" : ""}${line}`;
          }
        } else if (mk === "total") {
          if (line === undefined) return toolError("Pass line = the total, e.g. 54.5.");
          const [tot] = await loadSeries(g, ["KXNFLTOTAL"]);
          const l = ladder(tot.markets, () => true);
          result = overFromLadder(l, line);
          used = l;
          label = `Over ${line}`;
        } else {
          const s = market.toUpperCase();
          if (!seriesInfo(s) || seriesInfo(s)!.kind !== "player_threshold") return toolError(`Unknown market '${market}'. Use spread, total, moneyline or a player series from market_sources_list.`);
          if (!player || line === undefined) return toolError("Player markets need player and line (anytime TD: line 0.5).");
          const [ps] = await loadSeries(g, [s]);
          if (!ps.exists) return toolError(`${s} is not listed for ${g.key}.`);
          const names = Array.from(new Set(ps.markets.map((m) => m.player).filter((n): n is string => Boolean(n) && n!.toLowerCase().includes(player.toLowerCase()))));
          if (names.length !== 1) return toolError(names.length ? `Player filter matches several: ${names.join(", ")}.` : `No ${s} markets for '${player}' in ${g.key}.`);
          const l = ladder(ps.markets, (m) => m.player === names[0]);
          result = overFromLadder(l, line);
          used = l;
          label = `${names[0]} over ${line} (${seriesInfo(s)!.stat})`;
        }
        const anyThin = (used as { thin?: boolean }[]).some((u) => u.thin);
        const md = [`# Market probability — ${label} — ${g.away} @ ${g.home} (${g.date})`, threeWayText(result),
          result.p_win !== null ? `Fair odds (no push): ${fmtOdds(fairAmerican(result.p_win / ((result.p_win ?? 0) + (result.p_loss ?? 0))))}` : "",
          anyThin ? "⚠ At least one rung used is a thin market — treat as low confidence." : "",
          used.length ? `Rungs: ${(used as { strike: number; p: number }[]).map((u) => `>${u.strike}: ${pct(u.p)}`).join(", ")}` : ""];
        return toolText(md.filter(Boolean).join("\n"), { game: g, label, ...result, thin_rung_used: anyThin, rungs: used }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // ------------------------------------------------------------------ history
  server.registerTool(
    "kalshi_price_history",
    {
      title: "Price history for one Kalshi market",
      description:
        "Candlesticks (bid/ask/mid close, last trade, volume) for one market ticker between two times, at 1-minute, 1-hour or 1-day periods. Uses the live endpoint and falls back to Kalshi's historical endpoint for older settled markets. Pass `at` to also get the last reading at or before that time (e.g. a bet time or kickoff).",
      inputSchema: {
        ticker: z.string().describe("e.g. KXNFLTD-26SEP17DETBUF-BUFJCOOK4-1"),
        start: isoDate,
        end: isoDate,
        interval: z.enum(["1m", "1h", "1d"]).default("1h"),
        at: isoDate.optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ ticker, start, end, interval, at, response_format }) => {
      try {
        const s = Math.floor(Date.parse(start) / 1000);
        const e = Math.floor(Date.parse(end) / 1000);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return toolError("start and end must be valid ISO times with end after start.");
        const per = interval === "1m" ? 1 : interval === "1h" ? 60 : 1440;
        if (per === 1 && e - s > 3 * 86400) return toolError("1-minute history is limited here to 3 days per call.");
        const series = ticker.split("-")[0];
        const r = await candles(series, ticker, s, e, per as 1 | 60 | 1440);
        let atRow = null;
        if (at) {
          const t = Date.parse(at);
          atRow = [...r.rows].reverse().find((c) => Date.parse(c.end) <= t && c.mid !== null) ?? null;
        }
        const md = [`# ${ticker} — ${interval} candles (${r.source} endpoint), retrieved ${r.retrieved_at}`,
          at ? `**At ${at}:** ${atRow ? `mid ${pct(atRow.mid)} (period ending ${atRow.end})` : "no priced candle at or before this time"}` : "",
          "| Period end | bid | ask | mid | last | volume |", "|---|---|---|---|---|---|",
          ...r.rows.map((c) => `| ${c.end} | ${c.bid ?? "-"} | ${c.ask ?? "-"} | ${pct(c.mid)} | ${c.last ?? "-"} | ${c.volume === null ? "-" : Math.round(c.volume)} |`)];
        return toolText(md.filter(Boolean).join("\n"), { ticker, interval, source: r.source, at_row: atRow, candles: r.rows }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "kalshi_closing_prices",
    {
      title: "Closing market probabilities for one game (CLV benchmark)",
      description:
        "For a game that has kicked off: the last priced 1-minute reading at or before kickoff (minus minutes_before_kickoff) for each market in the chosen series — winner, spread and total rungs, or player props filtered to one player. The closing mid is the CLV benchmark for a bet placed earlier. Kickoff time comes from espn_dk_game_lines or the schedule. At most 60 markets per call.",
      inputSchema: {
        game: gameArg,
        date: dateArg.optional(),
        kickoff: isoDate,
        series: z.array(z.string()).min(1).max(4).default(["KXNFLGAME"]),
        player: z.string().optional(),
        minutes_before_kickoff: z.number().int().min(0).max(240).default(0),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ game, date, kickoff, series, player, minutes_before_kickoff, response_format }) => {
      try {
        const k = Date.parse(kickoff);
        if (!Number.isFinite(k)) return toolError(`Invalid kickoff: ${kickoff}`);
        if (k > Date.now()) return toolError("This game has not kicked off — no closing price yet. Use kalshi_game_markets / kalshi_player_props for current prices.");
        const cutoff = k - minutes_before_kickoff * 60_000;
        const g = await resolveGame(game, date);
        const list = await loadSeries(g, series.map((s) => s.toUpperCase()));
        let ms = list.flatMap((l) => l.markets);
        if (player) ms = ms.filter((m) => (m.player ?? "").toLowerCase().includes(player.toLowerCase()));
        if (ms.length > 60) return toolError(`${ms.length} markets match — narrow with player or fewer series (limit 60).`);
        const endTs = Math.floor(cutoff / 1000);
        const got = await candlesMany(ms.map((m) => ({ series: m.series, ticker: m.ticker })), endTs - 3 * 3600, endTs, 1);
        const rows = ms.map((m, i) => {
          const c = [...got[i].rows].reverse().find((x) => Date.parse(x.end) <= cutoff && x.mid !== null) ?? null;
          return { ticker: m.ticker, series: m.series, team: m.team, player: m.player, strike: m.strike, close_mid: c?.mid ?? null, close_at: c?.end ?? null, result: m.result, error: got[i].error };
        });
        const md = [`# Closing prices — ${g.away} @ ${g.home} — cutoff ${new Date(cutoff).toISOString()}`,
          "| Market | Team/Player | Strike | Closing mid | Reading at | Result |", "|---|---|---|---|---|---|",
          ...rows.map((r) => `| ${r.series} | ${r.player ?? r.team ?? "-"} | ${r.strike ?? "-"} | ${pct(r.close_mid)} | ${r.close_at ?? (r.error ? `error: ${r.error.slice(0, 60)}` : "no priced candle in the 3 h before cutoff")} | ${r.result ?? "-"} |`)];
        return toolText(md.join("\n"), { game: g, cutoff: new Date(cutoff).toISOString(), rows }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "kalshi_settled_results",
    {
      title: "Settled results for a game's Kalshi markets",
      description: "Yes/No results for every market in the chosen series for a finished game — outcome labels for backtests (e.g. which players scored, which yardage rungs hit).",
      inputSchema: {
        game: gameArg,
        date: dateArg.optional(),
        series: z.array(z.string()).min(1).max(8).default(["KXNFLGAME", "KXNFLTD"]),
        player: z.string().optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ game, date, series, player, response_format }) => {
      try {
        const g = await resolveGame(game, date);
        const list = await loadSeries(g, series.map((s) => s.toUpperCase()));
        let ms = list.flatMap((l) => l.markets);
        if (player) ms = ms.filter((m) => (m.player ?? "").toLowerCase().includes(player.toLowerCase()));
        const unsettled = ms.filter((m) => !m.result).length;
        const md = [`# Results — ${g.away} @ ${g.home} (${g.date})`, unsettled ? `${unsettled} market(s) not settled yet.` : "",
          "| Market | Team/Player | Threshold | Result |", "|---|---|---|---|",
          ...ms.map((m) => `| ${m.series} | ${m.player ?? m.team ?? "-"} | ${m.threshold_label ?? (m.strike !== null ? `> ${m.strike}` : "-")} | ${m.result ?? "pending"} |`)];
        return toolText(md.filter(Boolean).join("\n"), { game: g, markets: ms.map((m) => ({ ticker: m.ticker, series: m.series, team: m.team, player: m.player, strike: m.strike, result: m.result })) }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // ------------------------------------------------------------------ ESPN / DraftKings
  server.registerTool(
    "espn_dk_game_lines",
    {
      title: "DraftKings game lines (via ESPN), opening and current",
      description:
        "DraftKings spread, total and moneyline for each NFL game in a date range, from ESPN's public scoreboard: current line and price, opening line and price, and the two-way vig-free probability at the current prices. Also gives ESPN event ids and kickoff times. Caveats: unofficial feed; no per-price timestamp (retrieved_at only); ESPN's 'close' field is the current price until kickoff. FanDuel and Fanatics are not available here.",
      inputSchema: {
        start_date: dateArg,
        end_date: dateArg.optional(),
        team: z.string().optional(),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ start_date, end_date, team, response_format }) => {
      try {
        const r = await scoreboard(start_date, end_date ?? start_date);
        const t = team?.toUpperCase();
        const games = r.games.filter((g) => !t || g.home === t || g.away === t);
        const md = [`# DraftKings lines via ESPN — retrieved ${r.retrieved_at}`, "No per-price timestamp is published; confirm in the DraftKings app before betting.\n"];
        for (const g of games) {
          md.push(`## ${g.away} @ ${g.home} — ${g.kickoff} (ESPN id ${g.espn_id}, ${g.status})`);
          if (!g.provider) {
            md.push("No DraftKings odds in the feed for this game.\n");
            continue;
          }
          md.push("| Market | Side | Current | Open | Vig-free (current) |", "|---|---|---|---|---|");
          if (g.spread) {
            md.push(`| Spread | ${g.home} | ${g.spread.home.line ?? "-"} (${fmtOdds(g.spread.home.price)}) | ${g.spread.home.open_line ?? "-"} (${fmtOdds(g.spread.home.open_price)}) | ${pct(g.spread.vig_free_home)} |`,
              `| Spread | ${g.away} | ${g.spread.away.line ?? "-"} (${fmtOdds(g.spread.away.price)}) | ${g.spread.away.open_line ?? "-"} (${fmtOdds(g.spread.away.open_price)}) | ${pct(g.spread.vig_free_home === null ? null : 1 - g.spread.vig_free_home)} |`);
          }
          if (g.total) {
            md.push(`| Total | Over | ${g.total.over.line ?? "-"} (${fmtOdds(g.total.over.price)}) | ${g.total.over.open_line ?? "-"} (${fmtOdds(g.total.over.open_price)}) | ${pct(g.total.vig_free_over)} |`,
              `| Total | Under | ${g.total.under.line ?? "-"} (${fmtOdds(g.total.under.price)}) | ${g.total.under.open_line ?? "-"} (${fmtOdds(g.total.under.open_price)}) | ${pct(g.total.vig_free_over === null ? null : 1 - g.total.vig_free_over)} |`);
          }
          if (g.moneyline) {
            md.push(`| Moneyline | ${g.home} | ${fmtOdds(g.moneyline.home.price)} | ${fmtOdds(g.moneyline.home.open_price)} | ${pct(g.moneyline.vig_free_home)} |`,
              `| Moneyline | ${g.away} | ${fmtOdds(g.moneyline.away.price)} | ${fmtOdds(g.moneyline.away.open_price)} | ${pct(g.moneyline.vig_free_home === null ? null : 1 - g.moneyline.vig_free_home)} |`);
          }
          md.push("");
        }
        return toolText(md.join("\n"), { retrieved_at: r.retrieved_at, book: "DraftKings (via ESPN)", games }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "espn_dk_prop_lines",
    {
      title: "DraftKings player prop lines (via ESPN) — lines only",
      description:
        "DraftKings player prop LINES for one game from ESPN's public core feed: prop type, current line, opening line, lastUpdated. ESPN publishes no prices for these, so no break-even or vig-free probability can be computed — pair a line with kalshi_line_probability for the market probability and with a pasted DraftKings price for the break-even. Filter by player or prop type text.",
      inputSchema: {
        espn_id: z.string().regex(/^\d+$/).describe("ESPN event id from espn_dk_game_lines"),
        player: z.string().optional(),
        type_contains: z.string().optional().describe("e.g. 'Receiving Yards' or 'Touchdown'"),
        limit: z.number().int().min(1).max(300).default(80),
        offset: z.number().int().min(0).default(0),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ espn_id, player, type_contains, limit, offset, response_format }) => {
      try {
        const r = await propLines(espn_id);
        let lines = r.lines;
        if (player) lines = lines.filter((l) => l.player.toLowerCase().includes(player.toLowerCase()));
        if (type_contains) lines = lines.filter((l) => l.type.toLowerCase().includes(type_contains.toLowerCase()));
        const total = lines.length;
        const page = lines.slice(offset, offset + limit);
        const future = page.some((l) => l.future_timestamp);
        const md = [`# DraftKings prop lines via ESPN — event ${espn_id} — retrieved ${r.retrieved_at}`,
          "Lines only (no prices). ", future ? "⚠ Some lastUpdated values are later than server time — reported as given." : "",
          r.athletes_unresolved ? `${r.athletes_unresolved} athlete names not resolved (cap reached).` : "",
          `Showing ${page.length} of ${total} (offset ${offset}).`,
          "| Player | Prop | Current | Open | Last updated |", "|---|---|---|---|---|",
          ...page.map((l) => `| ${l.player} | ${l.type} | ${l.current ?? "-"} | ${l.open ?? "-"} | ${l.last_updated ?? "-"}${l.future_timestamp ? " ⚠" : ""} |`)];
        return toolText(md.filter(Boolean).join("\n"), { retrieved_at: r.retrieved_at, espn_id, total, offset, limit, has_more: offset + limit < total, lines: page }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "espn_injuries",
    {
      title: "Injury list for one game (via ESPN)",
      description: "Injury entries ESPN lists for both teams in one game: player, position, status, detail and the entry's date. Unofficial feed; the official NFL report remains the authority for game-status designations.",
      inputSchema: { espn_id: z.string().regex(/^\d+$/), team: z.string().optional(), response_format: responseFormat },
      annotations: ro,
    },
    async ({ espn_id, team, response_format }) => {
      try {
        const r = await injuries(espn_id);
        const rows = team ? r.rows.filter((x) => x.team === team.toUpperCase()) : r.rows;
        const md = [`# Injuries via ESPN — event ${espn_id} — retrieved ${r.retrieved_at}`,
          rows.length ? "| Team | Player | Pos | Status | Detail | Date |\n|---|---|---|---|---|---|" : "No injury entries in the feed.",
          ...rows.map((x) => `| ${x.team} | ${x.player} | ${x.position ?? "-"} | ${x.status ?? "-"} | ${x.detail ?? "-"} | ${x.date ?? "-"} |`)];
        return toolText(md.join("\n"), { retrieved_at: r.retrieved_at, espn_id, rows }, response_format);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // ------------------------------------------------------------------ raw
  server.registerTool(
    "market_raw_get",
    {
      title: "Raw GET against an allowed public source",
      description:
        "Escape hatch (mirrors gis_raw_query / municode_raw_get): GET any URL on api.elections.kalshi.com, site.api.espn.com, sports.core.api.espn.com or api.weather.gov with hand-built query parameters — for discovering new Kalshi series (e.g. /trade-api/v2/series/KXNFLxxx) or ESPN fields. Returns raw JSON, truncated at the character limit. Promote anything useful into src/registry.ts.",
      inputSchema: { url: z.string().url(), params: z.record(z.string()).optional() },
      annotations: { ...ro, idempotentHint: false },
    },
    async ({ url, params }) => {
      try {
        const u = url;
        const r = await getJson<unknown>(u, params ?? {}, u.includes("api.weather.gov") ? { Accept: "application/geo+json" } : {});
        const body = { retrieved_at: r.retrieved_at, url: r.url, data: r.data };
        return toolText(JSON.stringify(body, null, 2), body as Record<string, unknown>, "markdown");
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // ------------------------------------------------------------------ weather
  server.registerTool(
    "wx_game_forecast",
    {
      title: "NWS hourly forecast at a stadium around kickoff",
      description:
        "National Weather Service hourly forecast for the home stadium (team abbreviation, from the registry) or any lat/lon, from `hours_before` kickoff to `hours_after`: temperature, sustained wind, gusts (grid data), direction, precipitation chance and short forecast, with the forecast's own update time. Domes and fixed roofs are reported as indoor (no weather call). Retractable roofs return the forecast with a note that roof status is unknown. NWS covers the US only and about 7 days ahead; beyond that the tool says so rather than guessing.",
      inputSchema: {
        team: z.string().optional().describe("Home team abbreviation, e.g. BUF (nflverse style: LA = Rams)"),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        kickoff: isoDate,
        hours_before: z.number().int().min(0).max(6).default(1),
        hours_after: z.number().int().min(1).max(6).default(4),
        response_format: responseFormat,
      },
      annotations: ro,
    },
    async ({ team, lat, lon, kickoff, hours_before, hours_after, response_format }) => {
      try {
        const st = team ? stadiumFor(team) : undefined;
        if (team && !st) return toolError(`Unknown team '${team}'. Use an abbreviation from market_sources_list (stadiums), or pass lat/lon for a neutral site.`);
        const la = lat ?? st?.lat;
        const lo = lon ?? st?.lon;
        if (la === undefined || lo === undefined) return toolError("Pass a home team abbreviation or lat and lon.");
        const venue = st ? `${st.name} (${st.team}, ${st.roof})` : `custom point ${la}, ${lo}`;
        if (st && (st.roof === "dome" || st.roof === "fixed_canopy") && lat === undefined) {
          return toolText(`# Weather — ${venue}\nIndoor venue: weather does not affect play. No forecast requested.`, { venue, roof: st.roof, indoor: true, rows: [] }, response_format);
        }
        const f = await kickoffForecast(la, lo, kickoff, hours_before, hours_after);
        const notes: string[] = [];
        if (st?.roof === "retractable") notes.push("Retractable roof — whether it will be open is not known from this source.");
        if (st?.note) notes.push(st.note);
        if (st && !st.verified) notes.push("Stadium coordinates are ⟨verify at run⟩ (approximate; well inside one forecast grid cell).");
        if (f.beyond_horizon) notes.push("Kickoff is beyond the NWS hourly forecast horizon (~7 days) — no forecast yet; check again closer to the game.");
        if (f.gust_note) notes.push(f.gust_note);
        const maxWind = Math.max(...f.rows.map((r) => r.wind_mph ?? 0), 0);
        const maxGust = Math.max(...f.rows.map((r) => r.gust_mph ?? 0), 0);
        const md = [`# Weather — ${venue}`, `Kickoff ${kickoff}. NWS grid ${f.grid}; forecast updated ${f.forecast_updated ?? "?"}; retrieved ${f.retrieved_at}.`,
          ...notes.map((n) => `- ${n}`),
          f.rows.length ? `\nPeak sustained wind ${maxWind} mph, peak gust ${maxGust || "n/a"} mph in the window.` : "\nNo hourly periods fall in the requested window.",
          "", "| Hour | Temp °F | Wind mph | Gust mph | Dir | Precip % | Forecast |", "|---|---|---|---|---|---|---|",
          ...f.rows.map((r) => `| ${r.start} | ${r.temp_f ?? "-"} | ${r.wind_mph ?? "-"} | ${r.gust_mph ?? "-"} | ${r.wind_dir ?? "-"} | ${r.precip_prob ?? "-"} | ${r.short ?? "-"} |`)];
        return toolText(md.join("\n"), { venue, roof: st?.roof ?? null, lat: la, lon: lo, kickoff, ...f, peak_wind_mph: maxWind, peak_gust_mph: maxGust || null, notes }, response_format);
      } catch (e) {
        return toolError(`Weather lookup failed: ${(e as Error).message}. No forecast returned — do not assume calm conditions.`);
      }
    }
  );
}
