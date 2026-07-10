// 规则引擎 —— 规则 1/2/3 均为纯函数，产出有向边（from 比 to 强）。
import type { Series } from "../../shared/types";
import type { Edge, Filters, SeriesEvidence, Tally } from "./types";
import {
  edgeStrength,
  inScope,
  inTimeWindow,
  leaguepediaUrl,
  scopeDowngradeSequence,
} from "./types";

// ---------- 通用工具 ----------

/** series 是否为平局（Bo2 1-1）。 */
export function isDraw(s: Series): boolean {
  return s.s1 === s.s2;
}

/** 从某队视角取 [自己得分, 对手得分]；若该队不在此 series 返回 null。 */
function fromPerspective(s: Series, team: string): { self: number; opp: number; oppId: string } | null {
  if (s.t1 === team) return { self: s.s1, opp: s.s2, oppId: s.t2 };
  if (s.t2 === team) return { self: s.s2, opp: s.s1, oppId: s.t1 };
  return null;
}

export function toEvidence(s: Series, team: string): SeriesEvidence {
  const p = fromPerspective(s, team)!;
  return {
    id: s.id,
    date: s.date,
    tournament: s.tournament,
    tier: s.tier,
    best_of: s.best_of,
    flags: s.flags,
    self: team,
    opp: p.oppId,
    selfScore: p.self,
    oppScore: p.opp,
    url: leaguepediaUrl(s.tournament),
  };
}

/** 表现档位 0/1/2（用于规则 2 跨赛制比较）。 */
export function performanceTier(selfScore: number, oppScore: number): 0 | 1 | 2 {
  if (selfScore > oppScore) {
    // 胜
    if (oppScore === 0) return 2; // 横扫 2-0 / 3-0
    if (selfScore - oppScore >= 2) return 1; // 3-1
    return 0; // 决胜局险胜 2-1 / 3-2
  }
  // 负
  if (selfScore === 0) return 0; // 被横扫 0-2 / 0-3
  if (oppScore - selfScore >= 2) return 1; // 1-3
  return 2; // 打满决胜局 1-2 / 2-3
}

/** 过滤出时间窗内、双方均参与、非表演赛的 series。 */
function seriesBetween(all: Series[], a: string, b: string, f: Filters): Series[] {
  return all.filter(
    (s) => inTimeWindow(s, f) && ((s.t1 === a && s.t2 === b) || (s.t1 === b && s.t2 === a)),
  );
}

// ---------- 规则 1：直接交手 ----------

/** 时间窗内 A、B 最近一次 series，胜者得边。Bo1 计入。平局不产边。 */
export function rule1(all: Series[], a: string, b: string, f: Filters): Edge | null {
  const between = seriesBetween(all, a, b, f).filter((s) => s.s1 !== s.s2);
  if (!between.length) return null;
  const latest = between.reduce((m, s) => (Date.parse(s.date) > Date.parse(m.date) ? s : m));
  const p = fromPerspective(latest, a)!;
  const winner = p.self > p.opp ? a : b;
  const loser = winner === a ? b : a;
  return {
    from: winner,
    to: loser,
    rule: 1,
    strength: edgeStrength(1, latest.date),
    date: latest.date,
    evidence: { kind: "rule1", series: toEvidence(latest, winner) },
  };
}

// ---------- 规则 3：历史战绩 ----------

interface RecordStat {
  wins: number;
  total: number;
  rate: number;
}

/** 在给定范围下统计 A 相对 B 的战绩（大局或小局口径）。 */
function recordFor(series: Series[], a: string, tally: Tally): RecordStat {
  if (tally === "series") {
    let wins = 0;
    let total = 0;
    for (const s of series) {
      if (s.s1 === s.s2) continue; // Bo2 1-1 大局口径剔除
      total++;
      const p = fromPerspective(s, a)!;
      if (p.self > p.opp) wins++;
    }
    return { wins, total, rate: total ? wins / total : 0 };
  }
  // 小局口径：由比分推得，Bo2 1-1 正常计入
  let win = 0;
  let games = 0;
  for (const s of series) {
    const p = fromPerspective(s, a)!;
    win += p.self;
    games += p.self + p.opp;
  }
  return { wins: win, total: games, rate: games ? win / games : 0 };
}

/**
 * 规则 3：窗口 + 范围内 A vs B 胜率严格 > 2/3 产边。
 * 范围自动降级：从用户当前范围向更窄（国际赛→仅 Worlds）依次尝试，第一个通过者产边。
 */
export function rule3(all: Series[], a: string, b: string, f: Filters): Edge | null {
  const between = seriesBetween(all, a, b, f);
  if (!between.length) return null;
  const seq = scopeDowngradeSequence(f.scope);
  for (const scope of seq) {
    const scoped = between.filter((s) => inScope(s, scope));
    if (!scoped.length) continue;
    const stat = recordFor(scoped, a, f.tally);
    if (stat.total > 0 && stat.rate > 2 / 3) {
      const latest = scoped.reduce((m, s) => (Date.parse(s.date) > Date.parse(m.date) ? s : m));
      return {
        from: a,
        to: b,
        rule: 3,
        strength: edgeStrength(3, latest.date),
        date: latest.date,
        evidence: {
          kind: "rule3",
          wins: stat.wins,
          total: stat.total,
          rate: stat.rate,
          tally: f.tally,
          scopeUsed: scope,
          downgraded: scope !== f.scope,
          series: scoped
            .slice()
            .sort((x, y) => Date.parse(y.date) - Date.parse(x.date))
            .map((s) => toEvidence(s, a)),
        },
      };
    }
  }
  return null;
}

// ---------- 规则 2：共同对手 ----------

/** 判断同赛制下 A、B（同胜或同负于 C）谁更强；返回胜者视角或 null（比分相同）。 */
function sameFormatWinner(
  aEv: SeriesEvidence,
  bEv: SeriesEvidence,
): { winner: "a" | "b"; note: string } | null {
  const aWon = aEv.selfScore > aEv.oppScore;
  const bWon = bEv.selfScore > bEv.oppScore;
  if (aWon !== bWon) return null; // 一胜一负，不属规则 2
  if (aWon) {
    // 同胜：丢局少者强
    if (aEv.oppScore === bEv.oppScore) return null;
    const winner = aEv.oppScore < bEv.oppScore ? "a" : "b";
    return { winner, note: "同样击败共同对手，丢局更少" };
  }
  // 同负：拿局多者强
  if (aEv.selfScore === bEv.selfScore) return null;
  const winner = aEv.selfScore > bEv.selfScore ? "a" : "b";
  return { winner, note: "同样负于共同对手，拿下更多局" };
}

/** 跨赛制：按档位比较。strict 要求档位差 = 2。 */
function crossFormatWinner(
  aEv: SeriesEvidence,
  bEv: SeriesEvidence,
  strict: boolean,
): { winner: "a" | "b"; note: string } | null {
  const aWon = aEv.selfScore > aEv.oppScore;
  const bWon = bEv.selfScore > bEv.oppScore;
  if (aWon !== bWon) return null;
  const ta = performanceTier(aEv.selfScore, aEv.oppScore);
  const tb = performanceTier(bEv.selfScore, bEv.oppScore);
  if (ta === tb) return null;
  if (strict && Math.abs(ta - tb) !== 2) return null;
  const winner = ta > tb ? "a" : "b";
  return { winner, note: `跨赛制对比对手表现更强（档位 ${Math.max(ta, tb)} vs ${Math.min(ta, tb)}）` };
}

/** 两场 series 是否满足邻近窗口（同赛事自动满足）。 */
function proximityOk(x: SeriesEvidence, y: SeriesEvidence, days: number): boolean {
  if (x.tournament === y.tournament) return true;
  const gap = Math.abs(Date.parse(x.date) - Date.parse(y.date));
  return gap <= days * 24 * 3600 * 1000;
}

/**
 * 规则 2：经由共同对手 C 比较 A、B。对每个 C，取满足条件、时间最邻近的一对做证据。
 * Bo1 排除；仅同胜 / 同负。可能对不同 C 产出多条（含方向冲突）边——均返回。
 */
export function rule2(all: Series[], a: string, b: string, f: Filters): Edge[] {
  const inWin = all.filter((s) => inTimeWindow(s, f) && inScope(s, f.scope) && s.best_of >= 2);
  // C -> A/B 对 C 的 series
  const aVs = new Map<string, Series[]>();
  const bVs = new Map<string, Series[]>();
  for (const s of inWin) {
    const pa = a === s.t1 ? s.t2 : a === s.t2 ? s.t1 : null;
    if (pa && pa !== b) push(aVs, pa, s);
    const pb = b === s.t1 ? s.t2 : b === s.t2 ? s.t1 : null;
    if (pb && pb !== a) push(bVs, pb, s);
  }
  const edges: Edge[] = [];
  for (const [c, aSeriesList] of aVs) {
    const bSeriesList = bVs.get(c);
    if (!bSeriesList) continue;
    let best: { edge: Edge; gap: number } | null = null;
    for (const sa of aSeriesList) {
      for (const sb of bSeriesList) {
        const aEv = toEvidence(sa, a);
        const bEv = toEvidence(sb, b);
        if (!proximityOk(aEv, bEv, f.proximityDays)) continue;
        const sameFormat = sa.best_of === sb.best_of;
        const verdict = sameFormat
          ? sameFormatWinner(aEv, bEv)
          : crossFormatWinner(aEv, bEv, f.strict);
        if (!verdict) continue;
        const from = verdict.winner === "a" ? a : b;
        const to = verdict.winner === "a" ? b : a;
        const repDate = laterDate(sa.date, sb.date);
        const edge: Edge = {
          from,
          to,
          rule: 2,
          strength: edgeStrength(2, repDate),
          date: repDate,
          evidence: {
            kind: "rule2",
            via: c,
            aSeries: from === a ? aEv : bEv,
            bSeries: from === a ? bEv : aEv,
            sameFormat,
            note: verdict.note,
          },
        };
        const gap = Math.abs(Date.parse(sa.date) - Date.parse(sb.date));
        if (!best || gap < best.gap) best = { edge, gap };
      }
    }
    if (best) edges.push(best.edge);
  }
  return edges;
}

/**
 * 全局规则 2：一次性遍历所有共同对手 C，为每个 (X,Y,C) 产出至多一条边（时间最邻近对）。
 * 比逐对调用 rule2 高效得多，供建图使用。
 */
export function rule2All(all: Series[], f: Filters): Edge[] {
  const pool = all.filter(
    (s) => inTimeWindow(s, f) && inScope(s, f.scope) && s.best_of >= 2,
  );
  // 共同对手 C -> （对手 X -> X 对 C 的 series 列表）
  const byOpponent = new Map<string, Map<string, Series[]>>();
  for (const s of pool) {
    addOpp(byOpponent, s.t2, s.t1, s); // C=t2, X=t1
    addOpp(byOpponent, s.t1, s.t2, s); // C=t1, X=t2
  }
  const edges: Edge[] = [];
  for (const [c, opponents] of byOpponent) {
    const list = [...opponents.entries()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, xSeries] = list[i];
        const [y, ySeries] = list[j];
        const edge = bestPairEdge(x, y, c, xSeries, ySeries, f);
        if (edge) edges.push(edge);
      }
    }
  }
  return edges;
}

/** 在 X、Y 各自对 C 的 series 中，找满足条件、时间最邻近的一对并产边。 */
function bestPairEdge(
  x: string,
  y: string,
  c: string,
  xSeries: Series[],
  ySeries: Series[],
  f: Filters,
): Edge | null {
  let best: { edge: Edge; gap: number } | null = null;
  for (const sx of xSeries) {
    for (const sy of ySeries) {
      const xEv = toEvidence(sx, x);
      const yEv = toEvidence(sy, y);
      if (!proximityOk(xEv, yEv, f.proximityDays)) continue;
      const sameFormat = sx.best_of === sy.best_of;
      const verdict = sameFormat
        ? sameFormatWinner(xEv, yEv)
        : crossFormatWinner(xEv, yEv, f.strict);
      if (!verdict) continue;
      const from = verdict.winner === "a" ? x : y;
      const repDate = laterDate(sx.date, sy.date);
      const edge: Edge = {
        from,
        to: from === x ? y : x,
        rule: 2,
        strength: edgeStrength(2, repDate),
        date: repDate,
        evidence: {
          kind: "rule2",
          via: c,
          aSeries: from === x ? xEv : yEv,
          bSeries: from === x ? yEv : xEv,
          sameFormat,
          note: verdict.note,
        },
      };
      const gap = Math.abs(Date.parse(sx.date) - Date.parse(sy.date));
      if (!best || gap < best.gap) best = { edge, gap };
    }
  }
  return best?.edge ?? null;
}

function addOpp(m: Map<string, Map<string, Series[]>>, c: string, x: string, s: Series) {
  let inner = m.get(c);
  if (!inner) m.set(c, (inner = new Map()));
  push(inner, x, s);
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}
function laterDate(x: string, y: string): string {
  return Date.parse(x) >= Date.parse(y) ? x : y;
}
