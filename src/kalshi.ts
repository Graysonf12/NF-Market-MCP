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
    // Live API (checked 2026-09-16): without with_nested_markets the markets are top-level; with it,
    // they move under event.markets and the top-level array is empty. Accept whichever is non-empty.
    const r = await getJson<{ event: KEvent; markets?: KMarket[] }>(`${KALSHI_BASE()}/events/${encodeURIComponent(eventTicker)}`);
    const top = r.data.markets ?? [];
    const nested = r.data.event?.markets ?? [];
    const markets = top.length ? top : nested;
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
