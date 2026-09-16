// Offline test: starts mock Kalshi / ESPN / NWS servers (shapes copied from live responses seen
// 2026-09-16), starts the MCP server against them, and checks every tool through POST /mcp.
// Usage: npm run build && node test/mock-test.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const MOCK = 4011, MCP = 3998;
const B = `http://127.0.0.1:${MOCK}`;
const future = new Date(Date.now() + 2 * 86400_000); future.setUTCMinutes(0, 0, 0);
const kickoff = future.toISOString().replace(".000Z", "Z");
const pastKick = "2026-09-15T00:15:00Z";
const calls = [];

const mkt = (ticker, title, strike, bid, ask, vol = 5000, extra = {}) => ({
  ticker, event_ticker: ticker.split("-").slice(0, 2).join("-"), title, yes_sub_title: title, floor_strike: strike,
  yes_bid_dollars: bid.toFixed(4), yes_ask_dollars: ask.toFixed(4), last_price_dollars: ask.toFixed(4), volume_fp: String(vol), status: "active", result: "", ...extra,
});
const G = "26SEP17DETBUF";
const winner = [mkt(`KXNFLGAME-${G}-BUF`, "Buffalo wins", null, 0.67, 0.68, 800000), mkt(`KXNFLGAME-${G}-DET`, "Detroit wins", null, 0.32, 0.33, 500000)];
const spread = [
  mkt(`KXNFLSPREAD-${G}-BUF2`, "Buffalo wins by over 1.5", 1.5, 0.62, 0.63),
  mkt(`KXNFLSPREAD-${G}-BUF3`, "Buffalo wins by over 2.5", 2.5, 0.60, 0.61),
  mkt(`KXNFLSPREAD-${G}-BUF4`, "Buffalo wins by over 3.5", 3.5, 0.52, 0.53),
  mkt(`KXNFLSPREAD-${G}-BUF5`, "Buffalo wins by over 4.5", 4.5, 0.49, 0.50),
  mkt(`KXNFLSPREAD-${G}-BUF7`, "Buffalo wins by over 6.5", 6.5, 0.43, 0.44),
  mkt(`KXNFLSPREAD-${G}-BUF8`, "Buffalo wins by over 7.5", 7.5, 0.34, 0.36),
  mkt(`KXNFLSPREAD-${G}-DET3`, "Detroit wins by over 2.5", 2.5, 0.25, 0.26),
  mkt(`KXNFLSPREAD-${G}-DET4`, "Detroit wins by over 3.5", 3.5, 0.20, 0.21),
];
const total = [
  mkt(`KXNFLTOTAL-${G}-51`, "Over 50.5 points", 50.5, 0.60, 0.61),
  mkt(`KXNFLTOTAL-${G}-54`, "Over 53.5 points", 53.5, 0.53, 0.54),
  mkt(`KXNFLTOTAL-${G}-56`, "Over 55.5 points", 55.5, 0.45, 0.46),
];
const td = [
  mkt(`KXNFLTD-${G}-BUFJCOOK4-1`, "James Cook III: 1+ touchdowns", 0.5, 0.54, 0.55, 41412),
  mkt(`KXNFLTD-${G}-BUFJCOOK4-2`, "James Cook III: 2+ touchdowns", 1.5, 0.20, 0.22, 9000),
  mkt(`KXNFLTD-${G}-DETASTBROWN14-1`, "Amon-Ra St. Brown: 1+ touchdowns", 0.5, 0.42, 0.43, 24417),
  mkt(`KXNFLTD-${G}-DETJGOFF16-1`, "Jared Goff: 1+ touchdowns", 0.5, 0.0, 0.05, 200),
];
const recyds = [
  mkt(`KXNFLRECYDS-${G}-DETASTBROWN14-40`, "Amon-Ra St. Brown: 40+ receiving yards", 39.5, 0.85, 0.86),
  mkt(`KXNFLRECYDS-${G}-DETASTBROWN14-60`, "Amon-Ra St. Brown: 60+ receiving yards", 59.5, 0.66, 0.68),
  mkt(`KXNFLRECYDS-${G}-DETASTBROWN14-80`, "Amon-Ra St. Brown: 80+ receiving yards", 79.5, 0.50, 0.51),
  mkt(`KXNFLRECYDS-${G}-DETASTBROWN14-70`, "Amon-Ra St. Brown: 70+ receiving yards", 69.5, 0.46, 0.48), // violates monotonicity on purpose
];
const events = {
  KXNFLGAME: winner, KXNFLSPREAD: spread, KXNFLTOTAL: total, KXNFLTD: td, KXNFLRECYDS: recyds,
};
const settledWinner = [mkt("KXNFLGAME-26SEP14DENKC-KC", "Kansas City wins", null, 0.99, 1.0, 1, { status: "finalized", result: "yes" }),
  mkt("KXNFLGAME-26SEP14DENKC-DEN", "Denver wins", null, 0.0, 0.01, 1, { status: "finalized", result: "no" })];
const settledTd = [mkt("KXNFLTD-26SEP14DENKC-KCKWALKER9-1", "Kenneth Walker III: 1+ touchdowns", 0.5, 0.99, 1.0, 1, { status: "finalized", result: "yes" })];

function candle(ts, bid, ask, style) {
  return style === "live"
    ? { end_period_ts: ts, yes_bid: { close_dollars: bid.toFixed(4) }, yes_ask: { close_dollars: ask.toFixed(4) }, price: { close_dollars: ask.toFixed(4) }, volume_fp: "100" }
    : { end_period_ts: ts, yes_bid: { close: bid.toFixed(4) }, yes_ask: { close: ask.toFixed(4) }, price: { close: ask.toFixed(4) }, volume: "100" };
}

const scoreboard = { events: [{
  id: "401872932", date: kickoff, shortName: "DET @ BUF",
  competitions: [{ status: { type: { state: "pre" } }, competitors: [
    { homeAway: "home", team: { abbreviation: "BUF" } }, { homeAway: "away", team: { abbreviation: "DET" } }],
    odds: [{ provider: { id: "100", name: "DraftKings" }, details: "BUF -4.5", overUnder: 54.5, spread: -4.5,
      moneyline: { home: { close: { odds: "-238" }, open: { odds: "-162" } }, away: { close: { odds: "+195" }, open: { odds: "+136" } } },
      pointSpread: { home: { close: { line: "-4.5", odds: "-118" }, open: { line: "-3", odds: "-110" } }, away: { close: { line: "+4.5", odds: "-102" }, open: { line: "+3", odds: "-110" } } },
      total: { over: { close: { line: "o54.5", odds: "-118" }, open: { line: "o52.5", odds: "-110" } }, under: { close: { line: "u54.5", odds: "-102" }, open: { line: "u52.5", odds: "-110" } } } }] }] },
  { id: "401872999", date: kickoff, shortName: "WSH @ DAL", competitions: [{ status: { type: { state: "pre" } }, competitors: [
    { homeAway: "home", team: { abbreviation: "DAL" } }, { homeAway: "away", team: { abbreviation: "WSH" } }], odds: [] }] }] };

const athleteRef = (id) => `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/${id}?lang=en&region=us`;
const propItem = (id, type, cur, open, lu = "2026-09-16T19:00Z") => ({ athlete: { $ref: athleteRef(id) }, type: { id: "8", name: type }, lastUpdated: lu, current: { target: { value: cur } }, open: { target: { value: open } } });
const propPages = {
  1: { count: 5, pageIndex: 1, pageSize: 3, pageCount: 2, items: [propItem("3046779", "Total Passing Yards (incl. overtime)", 266.5, 256.5), propItem("3046779", "Total Passing Yards (incl. overtime)", 266.5, 256.5), propItem("4374302", "Total Receiving Yards", 74.5, 71.5)] },
  2: { count: 5, pageIndex: 2, pageSize: 3, pageCount: 2, items: [propItem("4374302", "Total Receptions", 7.5, 7.5, "2099-01-01T00:00Z"), propItem("9999999", "Total Rushing Yards", 20.5, 18.5)] },
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, B);
  calls.push(u);
  const json = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(JSON.stringify(body)); };
  const p = u.pathname;
  // ---- Kalshi
  if (p === "/trade-api/v2/events") {
    const s = u.searchParams.get("series_ticker"), st = u.searchParams.get("status");
    if (s === "KXNFLGAME" && st === "open") return json(200, { cursor: "", events: [
      { event_ticker: `KXNFLGAME-${G}`, series_ticker: "KXNFLGAME", title: "DET Lions vs BUF Bills", markets: winner },
      { event_ticker: "KXNFLGAME-26SEP21NYGLAR", series_ticker: "KXNFLGAME", title: "NY Giants vs LA Rams", markets: [mkt("KXNFLGAME-26SEP21NYGLAR-LAR", "Los Angeles R wins", null, 0.75, 0.76), mkt("KXNFLGAME-26SEP21NYGLAR-NYG", "New York G wins", null, 0.24, 0.25)] },
      { event_ticker: "KXNFLGAME-26SEP20JACDEN", series_ticker: "KXNFLGAME", title: "JAC vs DEN", markets: [] }] });
    if (s === "KXNFLGAME" && st === "settled") return json(200, { cursor: "", events: [{ event_ticker: "KXNFLGAME-26SEP14DENKC", series_ticker: "KXNFLGAME", markets: settledWinner }] });
    return json(200, { cursor: "", events: [] });
  }
  let m = /^\/trade-api\/v2\/events\/([A-Z0-9-]+)$/.exec(p);
  if (m) {
    const [series, key] = m[1].split("-");
    if (key === G && events[series]) {
      // alternate the two response shapes Kalshi documents
      return series === "KXNFLTD" ? json(200, { event: { event_ticker: m[1], series_ticker: series }, markets: events[series] })
        : json(200, { event: { event_ticker: m[1], series_ticker: series, markets: events[series] } });
    }
    if (key === "26SEP14DENKC" && series === "KXNFLGAME") return json(200, { event: { event_ticker: m[1], markets: settledWinner } });
    if (key === "26SEP14DENKC" && series === "KXNFLTD") return json(200, { event: { event_ticker: m[1], markets: settledTd } });
    return json(404, { error: { code: "not_found", message: "event not found" } });
  }
  m = /^\/trade-api\/v2\/series\/([A-Z0-9]+)\/markets\/([A-Z0-9-]+)\/candlesticks$/.exec(p);
  if (m) {
    const end = Number(u.searchParams.get("end_ts"));
    if (m[2].startsWith("KXNFLGAME-26SEP14DENKC-DEN")) return json(404, { error: { code: "not_found" } }); // force historical fallback
    return json(200, { ticker: m[2], candlesticks: [candle(end - 120, 0.40, 0.42, "live"), candle(end - 60, 0.47, 0.49, "live"), candle(end + 60, 0.99, 1.0, "live")] });
  }
  m = /^\/trade-api\/v2\/historical\/markets\/([A-Z0-9-]+)\/candlesticks$/.exec(p);
  if (m) {
    const end = Number(u.searchParams.get("end_ts"));
    return json(200, { ticker: m[1], candlesticks: [candle(end - 60, 0.30, 0.32, "hist")] });
  }
  // ---- ESPN
  if (p === "/espn/site/scoreboard") return json(200, scoreboard);
  if (p === "/espn/site/summary") return json(200, { injuries: [{ team: { abbreviation: "DET" }, injuries: [{ athlete: { displayName: "Christian Mahogany", position: { abbreviation: "G" } }, status: "Questionable", date: "2026-09-16T18:00Z", details: { type: "Knee" } }] }] });
  m = /^\/espn\/core\/events\/(\d+)\/competitions\/\d+\/odds\/100\/propBets$/.exec(p);
  if (m) return json(200, propPages[u.searchParams.get("page") || "1"]);
  m = /^\/espn\/core\/seasons\/2026\/athletes\/(\d+)$/.exec(p);
  if (m) return m[1] === "9999999" ? json(500, {}) : json(200, { displayName: m[1] === "3046779" ? "Jared Goff" : "Amon-Ra St. Brown" });
  // ---- NWS
  if (p.startsWith("/nws/points/")) return json(200, { properties: { gridId: "BUF", gridX: 40, gridY: 50, forecastHourly: `${B}/nws/hourly`, forecastGridData: `${B}/nws/grid` } }, "application/geo+json");
  if (p === "/nws/hourly") {
    const k = Date.parse(kickoff);
    const periods = [-2, -1, 0, 1, 2, 3, 4, 5].map((h) => ({ startTime: new Date(k + h * 3600_000).toISOString(), endTime: new Date(k + (h + 1) * 3600_000).toISOString(),
      temperature: 60 - h, temperatureUnit: "F", windSpeed: h === 1 ? "15 to 20 mph" : "12 mph", windDirection: "WSW", probabilityOfPrecipitation: { value: 10 }, shortForecast: "Mostly Cloudy" }));
    return json(200, { properties: { updateTime: "2026-09-16T19:00:00+00:00", generatedAt: "2026-09-16T20:00:00+00:00", periods } }, "application/geo+json");
  }
  if (p === "/nws/grid") return json(200, { properties: { windGust: { uom: "wmoUnit:km_h-1", values: [{ validTime: `${new Date(Date.parse(kickoff) - 7200_000).toISOString()}/PT6H`, value: 48.28 }] } } }, "application/geo+json");
  json(404, { message: "not found" });
});
await new Promise((r) => server.listen(MOCK, r));

const env = { ...process.env, PORT: String(MCP), KALSHI_API_BASE: `${B}/trade-api/v2`, ESPN_SITE_BASE: `${B}/espn/site`, ESPN_CORE_BASE: `${B}/espn/core`, NWS_API_BASE: `${B}/nws` };
const srv = spawn("node", ["dist/index.js"], { env, stdio: ["ignore", "ignore", "pipe"] });
await new Promise((r) => srv.stderr.once("data", r));

let id = 0;
async function rpc(method, params) {
  const res = await fetch(`http://127.0.0.1:${MCP}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return res.json();
}
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;
const text = (r) => r.content[0].text;
const close = (a, b, eps = 1e-6) => a !== null && Math.abs(a - b) < eps;
let passed = 0;
const ok = (label, cond, info) => { assert.ok(cond, `${label} ${info !== undefined ? JSON.stringify(info) : ""}`); passed++; console.log("PASS", label); };

try {
  const health = await (await fetch(`http://127.0.0.1:${MCP}/`)).json();
  ok("health: no keys, 13 tools", health.api_keys === "none" && health.tools.length === 13);
  ok("initialize", (await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } })).result.serverInfo.version === "2.0.0");
  ok("tools/list = 13", (await rpc("tools/list", {})).result.tools.length === 13);

  const src = await call("market_sources_list", { response_format: "json" });
  ok("sources list: kalshi + espn + nws, series, JAC->JAX", src.structuredContent.sources.length === 4 && src.structuredContent.teams.JAC === "JAX" && src.structuredContent.series.some((s) => s.ticker === "KXNFLTD"));

  const games = await call("kalshi_list_games", { response_format: "json" });
  const g0 = games.structuredContent.games;
  ok("list games parses keys incl. LAR->LA and JAC->JAX", g0.some((g) => g.key === "26SEP21NYGLAR" && g.home === "LA") && g0.some((g) => g.key === "26SEP20JACDEN" && g.away === "JAX"));
  const detbuf = g0.find((g) => g.key === G);
  ok("no-vig home win = 0.675/(0.675+0.325)", close(detbuf.home_novig, 0.675 / 1.0));

  const gm = await call("kalshi_game_markets", { game: "DET@BUF", home_spread: -4.5, total_line: 54.5, response_format: "json" });
  const d = gm.structuredContent.derived;
  ok("resolve AWAY@HOME to key", gm.structuredContent.game.key === G);
  ok("home -4.5 = exact strike P(BUF>4.5)=0.495", close(d.spread.p_win, 0.495) && d.spread.method.includes("exact"), d.spread);
  ok("total 54.5 interpolated between 53.5 and 55.5 = 0.495", close(d.total.over, 0.495) && d.total.method === "interpolated", d.total);

  const whole = await call("kalshi_line_probability", { game: G, market: "spread", line: -3, response_format: "json" });
  // P(BUF>3.5)=0.525 win; push = P(>2.5)-P(>3.5) = 0.605-0.525 = 0.08
  ok("home -3 (whole number): win .525, push .08", close(whole.structuredContent.p_win, 0.525) && close(whole.structuredContent.p_push, 0.08), whole.structuredContent);
  const dog = await call("kalshi_line_probability", { game: G, market: "spread", line: 3, response_format: "json" });
  // away (DET) ladder: P(DET>2.5)=.255, P(DET>3.5)=.205 -> BUF +3?? (home +3 means DET favored by 3) win = 1-.255, push=.05, loss=.205
  ok("home +3 via away ladder complement", close(dog.structuredContent.p_win, 0.745) && close(dog.structuredContent.p_push, 0.05) && close(dog.structuredContent.p_loss, 0.205), dog.structuredContent);
  const outside = await call("kalshi_line_probability", { game: G, market: "total", line: 60.5, response_format: "json" });
  ok("line outside ladder returns null (no extrapolation)", outside.structuredContent.p_win === null && outside.structuredContent.method === "outside_ladder");
  const ml = await call("kalshi_line_probability", { game: G, market: "moneyline", response_format: "json" });
  ok("moneyline", close(ml.structuredContent.p_win, 0.675));

  const tdp = await call("kalshi_line_probability", { game: G, market: "KXNFLTD", player: "cook", line: 0.5, response_format: "json" });
  ok("anytime TD Cook = .545 exact (nested-markets shape B)", close(tdp.structuredContent.p_win, 0.545) && tdp.structuredContent.method === "exact_strike", tdp.structuredContent);
  const ry = await call("kalshi_line_probability", { game: G, market: "KXNFLRECYDS", player: "St. Brown", line: 74.5, response_format: "json" });
  // isotonic: rungs 59.5 .67, 69.5 .47, 79.5 .505 -> pool 69.5/79.5 to .4875 ; 74.5 interpolated = .4875
  ok("rec yds 74.5 interpolated after isotonic fix", close(ry.structuredContent.p_win, 0.4875) && ry.structuredContent.method === "interpolated", ry.structuredContent);
  const amb = await call("kalshi_line_probability", { game: G, market: "KXNFLTD", player: "a", line: 0.5 });
  ok("ambiguous player refused", amb.isError && text(amb).includes("several"));
  const goff = await call("kalshi_player_props", { game: G, series: ["KXNFLTD"], player: "goff", response_format: "json" });
  ok("no-bid market flagged thin with note", goff.structuredContent.markets[0].thin && goff.structuredContent.markets[0].note.includes("no bid"));
  const props = await call("kalshi_player_props", { game: G, response_format: "markdown" });
  ok("props: unlisted series reported, not invented", text(props).includes("Not listed for this game") && text(props).includes("Amon-Ra St. Brown"));
  const badSeries = await call("kalshi_player_props", { game: G, series: ["KXNFLBOGUS"] });
  ok("unknown series refused", badSeries.isError);

  const hist = await call("kalshi_price_history", { ticker: `KXNFLTD-${G}-BUFJCOOK4-1`, start: "2026-09-16T00:00:00Z", end: "2026-09-16T12:00:00Z", interval: "1h", at: "2026-09-16T11:59:30Z", response_format: "json" });
  ok("price history: live shape parsed, 'at' picks last candle before time", hist.structuredContent.source === "live" && close(hist.structuredContent.at_row.mid, 0.48));

  const closing = await call("kalshi_closing_prices", { game: "26SEP14DENKC", kickoff: pastKick, series: ["KXNFLGAME", "KXNFLTD"], response_format: "json" });
  const rows = closing.structuredContent.rows;
  const kc = rows.find((r) => r.team === "KC" && r.series === "KXNFLGAME");
  const den = rows.find((r) => r.team === "DEN");
  ok("closing: last minute candle at/before kickoff (post-kickoff candle ignored)", close(kc.close_mid, 0.48) && kc.result === "yes", kc);
  ok("closing: historical fallback shape parsed", close(den.close_mid, 0.31), den);
  const notYet = await call("kalshi_closing_prices", { game: G, kickoff, series: ["KXNFLGAME"] });
  ok("closing refused before kickoff", notYet.isError);

  const res = await call("kalshi_settled_results", { game: "DEN@KC", date: "2026-09-14", series: ["KXNFLTD"], response_format: "json" });
  ok("settled results via AWAY@HOME + date (settled search)", res.structuredContent.game.key === "26SEP14DENKC" && res.structuredContent.markets[0].result === "yes");

  const dk = await call("espn_dk_game_lines", { start_date: kickoff.slice(0, 10), response_format: "json" });
  const buf = dk.structuredContent.games.find((g) => g.home === "BUF");
  // -118/-102: 0.541284/(0.541284+0.504950)=0.517368
  ok("DK spread current/open + vig-free", buf.spread.home.line === -4.5 && buf.spread.home.price === -118 && buf.spread.home.open_line === -3 && close(buf.spread.vig_free_home, 0.517368, 1e-5), buf.spread);
  ok("DK total line parsed from 'o54.5'", buf.total.over.line === 54.5 && buf.total.over.open_line === 52.5);
  ok("DK moneyline -238/+195", buf.moneyline.home.price === -238 && buf.moneyline.away.price === 195);
  ok("WSH mapped to WAS; missing odds reported", dk.structuredContent.games.some((g) => g.away === "WAS" && g.provider === null) && text(await call("espn_dk_game_lines", { start_date: kickoff.slice(0, 10), team: "DAL" })).includes("No DraftKings odds"));
  const sbCall = calls.filter((c) => c.pathname.endsWith("/scoreboard")).at(-1);
  ok("scoreboard requested by date", sbCall.searchParams.get("dates") === kickoff.slice(0, 10).replace(/-/g, ""));

  const pl = await call("espn_dk_prop_lines", { espn_id: "401872932", response_format: "json" });
  const lines = pl.structuredContent.lines;
  ok("prop lines: paginated, de-duplicated, names resolved", pl.structuredContent.total === 4 && lines.some((l) => l.player === "Jared Goff" && l.current === 266.5 && l.open === 256.5));
  ok("prop lines: future timestamp flagged", lines.find((l) => l.type === "Total Receptions").future_timestamp === true);
  ok("prop lines: unresolvable athlete labelled, not dropped", lines.some((l) => l.player.startsWith("athlete 9999999")));
  const plf = await call("espn_dk_prop_lines", { espn_id: "401872932", player: "st. brown", type_contains: "receiving", response_format: "json" });
  ok("prop lines filter", plf.structuredContent.total === 1 && plf.structuredContent.lines[0].current === 74.5);

  const inj = await call("espn_injuries", { espn_id: "401872932", response_format: "json" });
  ok("injuries parsed", inj.structuredContent.rows[0].player === "Christian Mahogany" && inj.structuredContent.rows[0].status === "Questionable");

  const raw = await call("market_raw_get", { url: `${B}/trade-api/v2/events`, params: { series_ticker: "KXNFLGAME", status: "open" } });
  ok("raw get on allowed (test) host", !raw.isError && text(raw).includes(G));
  const rawBad = await call("market_raw_get", { url: "https://example.com/x" });
  ok("raw get refuses other hosts", rawBad.isError && text(rawBad).includes("not allowed"));

  const wx = await call("wx_game_forecast", { team: "BUF", kickoff, response_format: "json" });
  ok("weather rows + wind parse + gust km/h->mph", wx.structuredContent.rows.length === 6 && wx.structuredContent.peak_wind_mph === 20 && wx.structuredContent.peak_gust_mph === 30);
  const dome = await call("wx_game_forecast", { team: "DET", kickoff });
  ok("dome short-circuit", text(dome).includes("Indoor venue"));

  const badGame = await call("kalshi_game_markets", { game: "XYZ@ABC" });
  ok("unknown game refused with guidance", badGame.isError);
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("FAIL", e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  server.close();
}
