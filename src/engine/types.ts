import type { Series, Tier, SeriesFlag } from "../../shared/types";

/** 赛事范围过滤。 */
export type Scope = "all" | "international" | "worlds";
/** 规则 3 统计口径。 */
export type Tally = "series" | "game";
/** 规则 id。 */
export type RuleId = 1 | 2 | 3;

/** 全局过滤器（用户可调，影响所有规则）。 */
export interface Filters {
  /** 起始日期 ISO（yyyy-mm-dd），null = 不限。 */
  start: string | null;
  /** 截止日期 ISO，null = 今天。 */
  end: string | null;
  scope: Scope;
  tally: Tally;
  /** 规则 2 邻近窗口（天）。 */
  proximityDays: number;
  /** 跨赛制严格模式（档位差必须 = 2）。 */
  strict: boolean;
}

/** 一条 series 从某队视角的规范化证据视图。 */
export interface SeriesEvidence {
  id: string;
  date: string;
  tournament: string;
  tier: Tier;
  best_of: number;
  flags: SeriesFlag[];
  /** 主语队 canonical_id。 */
  self: string;
  /** 对手 canonical_id。 */
  opp: string;
  selfScore: number;
  oppScore: number;
  /** Leaguepedia 赛事页链接。 */
  url: string;
}

export type Evidence =
  | { kind: "rule1"; series: SeriesEvidence }
  | {
      kind: "rule2";
      via: string; // 共同对手 canonical_id
      aSeries: SeriesEvidence; // from 队 vs C
      bSeries: SeriesEvidence; // to 队 vs C
      sameFormat: boolean;
      /** 人类可读的比较说明。 */
      note: string;
    }
  | {
      kind: "rule3";
      wins: number;
      total: number;
      rate: number;
      tally: Tally;
      scopeUsed: Scope;
      /** 是否因当前范围不产边而降级到更窄范围。 */
      downgraded: boolean;
      series: SeriesEvidence[];
    };

/** 有向边：from 比 to 强。 */
export interface Edge {
  from: string;
  to: string;
  rule: RuleId;
  /** 排序用标量：规则档位主导，同规则内时间越近越大。 */
  strength: number;
  /** 该边代表时间（同规则内比较用）。 */
  date: string;
  evidence: Evidence;
}

/** 一条论证：A → … → B 的路径（length 1 即直接证据）。 */
export interface Argument {
  path: Edge[];
  /** 链强度 = 最弱一环。 */
  chainStrength: number;
}

/** 判案结果。 */
export interface Verdict {
  a: string;
  b: string;
  /** 正方 A>B 的论证（已排序）。 */
  forward: Argument[];
  /** 反方 B>A 的论证（已排序）。 */
  reverse: Argument[];
  /** 正方无路径时的放宽建议。 */
  hint?: string;
}

/** 边强度标量：规则档位 * BIG + 时间戳，规则档位始终压过时间。
 * 规则 1（直接交手）最强，其次规则 2、规则 3，故取 (4 - rule) 作档位。 */
const RULE_BASE = 1e13;
export function edgeStrength(rule: RuleId, date: string): number {
  const t = Date.parse(date) || 0;
  return (4 - rule) * RULE_BASE + t;
}

/** series 是否落在时间窗内。 */
export function inTimeWindow(s: Series, f: Filters): boolean {
  const t = Date.parse(s.date);
  if (f.start && t < Date.parse(f.start)) return false;
  if (f.end) {
    // 截止日含当天：加一天再比较
    const endExclusive = Date.parse(f.end) + 24 * 3600 * 1000;
    if (t >= endExclusive) return false;
  }
  return true;
}

/** series 是否匹配给定范围。 */
export function inScope(s: Series, scope: Scope): boolean {
  if (scope === "all") return true;
  if (scope === "international") return s.tier === "international" || s.tier === "worlds";
  return s.tier === "worlds";
}

/** 从窄到宽的范围序列（用于规则 3 降级：不超过用户当前范围，向更窄尝试）。 */
export function scopeDowngradeSequence(scope: Scope): Scope[] {
  const order: Scope[] = ["all", "international", "worlds"];
  const start = order.indexOf(scope);
  return order.slice(start);
}

/** 出处链接：赛事标签是 OE 风格（如 "LCK 2024 Spring Playoffs"），
 * 无法可靠映射到 Leaguepedia 页面名，统一走站内搜索——首条结果即赛事页。 */
export function leaguepediaUrl(tournamentLabel: string): string {
  return "https://lol.fandom.com/wiki/Special:Search?query=" + encodeURIComponent(tournamentLabel);
}
