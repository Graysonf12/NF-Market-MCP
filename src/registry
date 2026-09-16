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
