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
