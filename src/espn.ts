/** ESPN public feeds (keyless, undocumented): DraftKings game lines, DK prop lines, injuries. */
import { ESPN_CORE_BASE, ESPN_SITE_BASE, getJson, mapLimit, SourceError } from "./http.js";
import { nowIso } from "./format.js";
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

/** ESPN rejects date ranges (HTTP 400, checked 2026-09-16), so fetch one day at a time (max 10 days). */
export async function scoreboard(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new SourceError("end_date must be a valid date on or after start_date.");
  const days: string[] = [];
  for (let t = start; t <= end && days.length < 10; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
  const results = await mapLimit(days, 3, (day) => getJson<any>(`${ESPN_SITE_BASE()}/scoreboard`, { dates: day }));
  const seen = new Set<string>();
  const games: EspnGame[] = [];
  for (const r of results) {
    for (const g of parseScoreboard(r.data)) {
      if (seen.has(g.espn_id)) continue;
      seen.add(g.espn_id);
      games.push(g);
    }
  }
  games.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const truncated = end - start > 9 * 86_400_000;
  return { games, retrieved_at: results.length ? results[results.length - 1].retrieved_at : nowIso(), truncated };
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
        detail: [i.details?.type, i.details?.detail, i.details?.side].filter((x) => x && x !== "Not Specified").join(" ") || null,
        date: i.date ?? null,
      });
    }
  }
  return { rows, retrieved_at: r.retrieved_at };
}
