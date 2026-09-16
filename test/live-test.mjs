// Live smoke test against a deployed server (all sources are free and keyless).
// Usage: node test/live-test.mjs https://YOUR-SERVICE.onrender.com/mcp
const BASE = process.argv[2] || "http://localhost:3000/mcp";
let id = 0;
async function rpc(method, params) {
  const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const text = await res.text();
  const jsonText = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") : text;
  return JSON.parse(jsonText);
}
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;
const show = (label, r, n = 1500) => console.log(`\n===== ${label} =====\n${(r?.content?.[0]?.text ?? JSON.stringify(r)).slice(0, n)}`);

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "live-test", version: "0" } });
console.log("== initialize:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
console.log("== tools:", (await rpc("tools/list", {})).result.tools.map((t) => t.name).join(", "));

const games = await call("kalshi_list_games", { response_format: "json" });
show("kalshi_list_games", games, 900);
const g = games.structuredContent?.games?.[0];
const today = new Date().toISOString().slice(0, 10);
const in7 = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const dk = await call("espn_dk_game_lines", { start_date: today, end_date: in7, response_format: "json" });
show("espn_dk_game_lines (next 7 days)", dk, 600);
if (g) {
  const dkGame = dk.structuredContent?.games?.find((x) => x.home === g.home && x.away === g.away);
  const hs = dkGame?.spread?.home?.line ?? undefined;
  const tl = dkGame?.total?.over?.line ?? undefined;
  show(`kalshi_game_markets ${g.key} at DK lines (${hs}, ${tl})`, await call("kalshi_game_markets", { game: g.key, home_spread: hs, total_line: tl }));
  show("kalshi_player_props anytime TD", await call("kalshi_player_props", { game: g.key, series: ["KXNFLTD"] }), 1200);
  if (dkGame) {
    show("espn_dk_prop_lines (receiving)", await call("espn_dk_prop_lines", { espn_id: dkGame.espn_id, type_contains: "Receiving Yards", limit: 10 }), 1200);
    show("espn_injuries", await call("espn_injuries", { espn_id: dkGame.espn_id }), 800);
    show(`wx_game_forecast ${g.home}`, await call("wx_game_forecast", { team: g.home, kickoff: dkGame.kickoff }), 800);
  }
}
