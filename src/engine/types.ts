import type { Series, Tier, SeriesFlag, Stage } from "../../shared/types";

/** 赛事范围过滤。 */
export type Scope = "all" | "international" | "worlds";
/** 规则 3 统计口径。 */
export type Tally = "series" | "game";
/** 规则 id。 */
export type RuleId = 1 | 2 | 3;
/** 跨赛制（Bo3 vs Bo5）对比模式：关闭 / 仅零封＞打满（档位差=2）/ 全档位。 */
export type CrossFormat = "off" | "strict" | "loose";

/** 全局过滤器（用户可调，影响所有规则）。 */
export interface Filters {
  /** 起始日期 ISO（yyyy-mm-dd），null = 不限。默认最近三个月。 */
  start: string | null;
  /** 截止日期 ISO，null = 今天。 */
  end: string | null;
  scope: Scope;
  tally: Tally;
  /** 规则 2 邻近窗口（天）。 */
  proximityDays: number;
  /** 跨赛制对比模式。 */
  crossFormat: CrossFormat;
  /** 传递链长度上限（边数）；7 = 不限（引擎硬上限）。 */
  maxChainLen: number;
}

/** 一条 series 从某队视角的规范化证据视图。 */
export interface SeriesEvidence {
  id: string;
  date: string;
  tournament: string;
  tier: Tier;
  league?: string;
  stage?: Stage;
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

/** 规则 2 比较结论的结构化说明（语言无关，UI 层用 i18n 格式化成文本）。 */
export type Rule2Note =
  | { kind: "sameWinFewerLosses" }
  | { kind: "sameLossMoreWins" }
  | { kind: "crossFormatTier"; higher: number; lower: number };

export type Evidence =
  | { kind: "rule1"; series: SeriesEvidence }
  | {
      kind: "rule2";
      via: string; // 共同对手 canonical_id
      aSeries: SeriesEvidence; // from 队 vs C
      bSeries: SeriesEvidence; // to 队 vs C
      sameFormat: boolean;
      /** 比较结论（结构化，供 UI 格式化）。 */
      note: Rule2Note;
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
  /** 含金量 Q ∈ (0,1]：规则可信度 × 比赛含金量 × 时间衰减（见 QUALITY）。 */
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

/** 放宽建议里单个可尝试的方向（语言无关）。 */
export type TipKey =
  | "clearStart"
  | "widenChainLen"
  | "widenScope"
  | "widenCrossFormat"
  | "widenProximity"
  | "switchTally";

/** 正方无路径时的放宽建议（结构化，供 UI 格式化）。 */
export type Hint = { kind: "missingData" } | { kind: "exhausted" } | { kind: "noPath"; tips: TipKey[] };

/** 判案结果。 */
export interface Verdict {
  a: string;
  b: string;
  /** 正方 A>B 的论证（已排序）。 */
  forward: Argument[];
  /** 反方 B>A 的论证（已排序）。 */
  reverse: Argument[];
  /** 正方无路径时的放宽建议。 */
  hint?: Hint;
}

/** 嘴硬模式：单个过滤器维度的改动（语言无关）。 */
export type FilterChange =
  | { kind: "scope"; value: Scope }
  | { kind: "tally"; value: Tally }
  | { kind: "proximity"; days: number }
  | { kind: "crossFormat"; value: CrossFormat }
  | { kind: "maxChainLen"; value: number }
  | { kind: "start"; value: string | null };

// ---------- 含金量（论据排序权重，可按需调整） ----------

export const QUALITY = {
  /** 规则本身的可信度：直接交手 > 共同对手 > 历史战绩。 */
  rule: { 1: 1.0, 2: 0.7, 3: 0.55 } as Record<RuleId, number>,
  /** 赛事级别：世界赛 > MSI/先锋赛 > 赛区。 */
  tier: { worlds: 1.0, international: 0.9, domestic: 0.75 } as Record<Tier, number>,
  /** 阶段：决赛 > 淘汰赛/季后赛 > 小组赛/常规赛。 */
  stage: {
    final: 1.0,
    knockout: 0.92,
    playoffs: 0.92,
    groups: 0.8,
    regular: 0.78,
  } as Record<Stage, number>,
  stageDefault: 0.8,
  /** 赛制：Bo5 > Bo3 > Bo2 > Bo1。 */
  bo: (n: number): number => (n >= 5 ? 1 : n >= 3 ? 0.85 : n === 2 ? 0.75 : 0.65),
  /** 时间衰减半衰期（天）：一年前的比赛含金量减半。 */
  halfLifeDays: 365,
  /** 传递链每多一环的折扣。 */
  chainDecay: 0.6,
  /** 规则 3 样本量因子：1 场 0.7、2 场 0.85、3 场及以上 1.0。 */
  sample: (n: number): number => Math.min(1, 0.55 + 0.15 * n),
};

/** 单场比赛的含金量（级别 × 阶段 × 赛制）。 */
export function matchQuality(tier: Tier, stage: Stage | undefined, bestOf: number): number {
  const st = stage ? QUALITY.stage[stage] : QUALITY.stageDefault;
  return QUALITY.tier[tier] * st * QUALITY.bo(bestOf);
}

/** 时间衰减因子（越新越接近 1）。 */
export function recencyFactor(date: string, now = Date.now()): number {
  const age = Math.max(0, now - (Date.parse(date) || now));
  return Math.pow(0.5, age / (QUALITY.halfLifeDays * 864e5));
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
