// 赛事选择与 tier 判定。
// 通过 Leagues 表按 Short 代码白名单选联赛，再从 Tournaments 表取目标赛事与其 Region，
// 据 (League, Region) 判定 tier：worlds / international / domestic。
import { cargoQueryAll } from "./cargo.ts";
import type { Tier } from "../shared/types";

/** 四大赛区（v1 核心）。 */
export const MAJOR_SHORTS = ["LPL", "LCK", "LEC", "LCS", "LTA", "LTA N", "LTA S"];
/** 三大国际赛。 */
export const INTL_SHORTS = ["MSI", "WCS", "FS"];
/** M5 小赛区（主要出现在国际赛入围赛的赛区）。 */
export const MINOR_SHORTS = ["VCS", "PCS", "CBLOL", "LLA", "LJL", "LCO", "TCL"];

/** 国际赛的 League 全名（Region=International 时才是真国际赛，否则是地区资格赛）。 */
const WORLDS_LEAGUE = "World Championship";
const MSI_LEAGUE = "Mid-Season Invitational";
const FIRST_STAND_LEAGUE = "First Stand";

export interface LeagueInfo {
  league: string; // 全名
  short: string;
  region: string;
  level: string;
}

export interface TournamentInfo {
  overviewPage: string;
  name: string;
  league: string;
  region: string;
  tier: Tier;
  /** 该队所属赛区标签（用于 team.region），国际赛为 "International"。 */
  regionTag: string;
}

/** 拉取 Leagues 表，按 Short 白名单挑出目标联赛。 */
export async function fetchTargetLeagues(includeMinor: boolean): Promise<Map<string, LeagueInfo>> {
  const rows = await cargoQueryAll({
    tables: "Leagues",
    fields: "League, League_Short=Short, Region, Level, IsOfficial",
  });
  const wanted = new Set([...MAJOR_SHORTS, ...INTL_SHORTS, ...(includeMinor ? MINOR_SHORTS : [])]);
  const map = new Map<string, LeagueInfo>();
  const seen = new Set<string>();
  for (const r of rows) {
    const short = (r.Short ?? "").trim();
    seen.add(`${short} | ${r.League} | ${r.Region} | ${r.Level}`);
    if (!short || !wanted.has(short)) continue;
    map.set(r.League, { league: r.League, short, region: r.Region ?? "", level: r.Level ?? "" });
  }
  console.log(`[leagues] 命中 ${map.size} 个目标联赛：`, [...map.values()].map((l) => l.short).join(", "));
  return map;
}

/** 拉取目标年份的赛事，过滤到目标联赛并判定 tier。 */
export async function fetchTournaments(
  years: number[],
  leagues: Map<string, LeagueInfo>,
): Promise<TournamentInfo[]> {
  const leagueNames = [...leagues.keys()];
  if (!leagueNames.length) return [];
  const yearClause = years.map((y) => `Year="${y}"`).join(" OR ");
  const leagueClause = leagueNames.map((l) => `League="${escapeQ(l)}"`).join(" OR ");
  const rows = await cargoQueryAll({
    tables: "Tournaments",
    fields: "Name, OverviewPage, League, Region, TournamentLevel, Year",
    where: `(${yearClause}) AND (${leagueClause})`,
    order_by: "DateStart",
  });

  const out: TournamentInfo[] = [];
  for (const r of rows) {
    const league = r.League ?? "";
    const region = r.Region ?? "";
    const level = r.TournamentLevel ?? "";
    // 排除表演赛/次级赛
    if (level && level !== "Primary") continue;
    const li = leagues.get(league);
    const tier = classifyTier(league, region);
    const regionTag = tier === "domestic" ? li?.region || region : "International";
    out.push({ overviewPage: r.OverviewPage, name: r.Name, league, region, tier, regionTag });
  }
  console.log(`[tournaments] 选中 ${out.length} 个赛事（${years.join(",")}）`);
  return out;
}

function classifyTier(league: string, region: string): Tier {
  const intl = region === "International";
  if (league === WORLDS_LEAGUE && intl) return "worlds";
  if ((league === MSI_LEAGUE || league === FIRST_STAND_LEAGUE) && intl) return "international";
  return "domestic";
}

function escapeQ(s: string): string {
  return s.replace(/"/g, '\\"');
}
