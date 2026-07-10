// 数据模型 —— scraper 产出、前端消费共用。
// JSON 按年分片存放于 public/data/。

/** 赛事级别。worlds ⊂ international，用于范围过滤（全部 / 国际赛 / 仅 Worlds）。 */
export type Tier = "worlds" | "international" | "domestic";

/** series 特殊标记：弃权 / 重赛等。 */
export type SeriesFlag = "ff" | "rematch" | "nullified";

/** 一次 BoX 对阵整体（大局）。 */
export interface Series {
  /** 稳定唯一 id（来自 Leaguepedia MatchId，回退为构造 id）。 */
  id: string;
  /** ISO 日期时间（UTC）。 */
  date: string;
  /** 所属赛事 OverviewPage，如 "LCK/2024 Season/Spring Season"。 */
  tournament: string;
  tier: Tier;
  /** 赛制：1/3/5。0 表示未知。 */
  best_of: number;
  /** 规范化 canonical_id。 */
  t1: string;
  t2: string;
  /** series 比分（大局内的小局胜场数）。 */
  s1: number;
  s2: number;
  flags: SeriesFlag[];
}

/** 战队实体（换血不换队，改名/收购通过别名归并）。 */
export interface Team {
  canonical_id: string;
  display_name: string;
  aliases: string[];
  region: string;
}

/** 逐局数据（M5，games-YYYY.json）。 */
export interface Game {
  series_id: string;
  game_n: number;
  /** 胜方 canonical_id。 */
  winner: string;
  blue?: string;
  red?: string;
}

export interface DataIndex {
  years: number[];
  counts: {
    series: number;
    teams: number;
    games?: number;
  };
  generated_at: string;
  /** 抓取的赛区白名单（诊断用）。 */
  regions?: string[];
}

/** 手工别名兜底：canonical_id -> 额外别名。 */
export interface OverridesFile {
  /** 强制归并：把 key（任意别名）映射到 canonical_id。 */
  merge: Record<string, string>;
  /** 战队展示名/赛区/曾用名覆盖。 */
  teams?: Record<string, { display_name?: string; region?: string; aliases?: string[] }>;
}
