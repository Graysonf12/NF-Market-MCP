# nfl-market-mcp-server

Connector for the **NF Agent** (NFL pregame betting analysis). Same pattern as the Parcel-GIS,
FEMA and Municode connectors: TypeScript, stateless streamable HTTP, `POST /mcp`, GitHub → Render
auto-deploy, a registry file instead of hard-coded coverage, shaped tools plus a raw escape hatch.

**No API keys and no paid plans.** Every source is public:

| Source | What it gives the agent | Type |
|---|---|---|
| **Kalshi public market-data API** | Market probabilities for game winner, spread and total ladders, and player props (anytime TD, receiving / rushing / passing yards, receptions); price history (candlesticks); settled results | Official, documented, keyless |
| **ESPN public scoreboard feed** | **DraftKings** spread / total / moneyline — current and opening price — plus ESPN event ids and kickoffs | Unofficial, undocumented |
| **ESPN public core feed** | DraftKings player prop **lines** (current and opening) — no prices | Unofficial, undocumented |
| **ESPN summary feed** | Injury entries per game | Unofficial, undocumented |
| **National Weather Service** | Hourly forecast and wind gusts at the stadium around kickoff | Government |

### What this does and doesn't cover

- **Market probability (p_market): yes** — from Kalshi, for sides, totals, anytime TD and yardage
  props, at the exact line a sportsbook offers (`kalshi_line_probability`).
- **Bettable prices: DraftKings game lines only.** FanDuel and Fanatics have no free keyless source,
  and DraftKings prop *prices* are not published by ESPN (lines only). Paste those prices, or the
  market is NO PRICE.
- **History: yes, for free** — Kalshi candlesticks give closing probabilities (CLV) and a backtest
  record. Game-winner history goes back to at least October 2025; the player TD series appears to
  start with the 2026 season, so prop history builds from here.
- Kalshi is a prediction-market exchange. It is used **only as a price reference** — bets are still
  placed only at your sportsbooks.

## Tools

| Tool | Purpose |
|---|---|
| `market_sources_list` | Sources + caveats, Kalshi series (verified or ⟨verify at run⟩), team codes, stadiums |
| `kalshi_list_games` | Open or settled NFL games with game keys and no-vig win probabilities |
| `kalshi_game_markets` | Winner, spread ladder, total ladder for one game; optional read at a book's spread/total |
| `kalshi_player_props` | Player ladders (anytime TD, yards, receptions…) for one game |
| `kalshi_line_probability` | Market win/push/loss probability at a sportsbook's exact line (spread, total, moneyline, player prop) |
| `kalshi_price_history` | Candlesticks for one market, with the reading at a given time |
| `kalshi_closing_prices` | Last reading before kickoff for a game's markets — the CLV benchmark |
| `kalshi_settled_results` | Yes/No outcomes per market — backtest labels |
| `espn_dk_game_lines` | DraftKings current + opening spread/total/moneyline with vig-free probability |
| `espn_dk_prop_lines` | DraftKings prop lines (no prices) for one game |
| `espn_injuries` | ESPN injury entries for one game |
| `market_raw_get` | Raw GET on the allowed hosts — how new Kalshi series get discovered |
| `wx_game_forecast` | NWS hourly forecast + gusts at the stadium around kickoff |

## Honesty rules (enforced in code)

- Kalshi mid-price = (bid + ask) / 2, fees excluded. Rungs with a bid/ask wider than 4¢ or volume
  under 1,000 are flagged ⚠thin; a market with no bid is flagged and its mid marked low-confidence.
- Ladders are cleaned to be non-increasing (isotonic) before reading. A line that is a Kalshi strike
  is read exactly; a line between strikes is interpolated and says so; a line outside the ladder
  returns null — never an extrapolation.
- Whole-number lines get exact win / push / loss from the neighbouring half-point strikes
  (e.g. −3: win = P(margin > 3.5), push = P(> 2.5) − P(> 3.5)).
- DraftKings prices via ESPN carry no timestamp; every response has the server's `retrieved_at`.
  On 2026-09-16 ESPN's core odds endpoint and summary "pickcenter" still showed the opening line
  while the scoreboard showed the live one, so game lines are read from the scoreboard only.
- ESPN prop `lastUpdated` values later than server time are flagged, not corrected.
- Series not listed for a game are reported as not listed — never filled in.
- `market_raw_get` only reaches the four allowed hosts.

## The registry (src/registry.ts)

Sources, Kalshi series (`verified` date or false), Kalshi ↔ nflverse team codes (JAC→JAX, LAR→LA),
and home stadiums (coordinates ⟨verify at run⟩; Buffalo's 2026 stadium flagged as a new venue).
Kalshi adds series over time — discover one with `market_raw_get`
(`https://api.elections.kalshi.com/trade-api/v2/series/KXNFL…`), then add a registry line.

## Local development

```bash
npm install
npm run build
npm run test:mock     # offline: mock Kalshi + ESPN + NWS, 39 checks through the real MCP endpoint
npm start             # listens on :3000, MCP endpoint = POST /mcp
```

Live smoke test against the deployed service:

```bash
node test/live-test.mjs https://YOUR-SERVICE.onrender.com/mcp
```

## Deploy (GitHub → Render)

Same as the other connectors — see `DEPLOYMENT.md`.

## Terms and reliability

Kalshi's market-data endpoints are public and documented. ESPN's feeds are public but undocumented
and can change or be rate-limited without notice; keep call volume low. This server reads data only
and never contacts a sportsbook.
