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
