// 抓取主入口。
// 用法：
//   npm run scrape                → 增量更新当年
//   npm run scrape -- --full      → 全量 2013 至今
//   npm run scrape -- --from=2021 --to=2025
//   npm run scrape -- --no-games  → 跳过逐局数据
//   npm run scrape -- --minor     → 含小赛区（默认 2021+ 已含）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cargoQueryAll, type CargoRow } from "./cargo.ts";
import { fetchTargetLeagues, fetchTournaments, type TournamentInfo } from "./tournaments.ts";
import { buildResolver, loadOverrides } from "./aliases.ts";
import { rowToSeries, rowToGame } from "./transform.ts";
import type { Series, Team, Game, DataIndex, OverridesFile } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "public", "data");

const FIRST_YEAR = 2013;
const MATCH_FIELDS =
  "Team1, Team2, Team1Score, Team2Score, Winner, BestOf, DateTime_UTC, OverviewPage, MatchId, FF, IsNullified";
const GAME_FIELDS = "OverviewPage, Blue, Red, Winner, MatchId, N_GameInMatch";

interface Args {
  years: number[];
  games: boolean;
  minor: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const now = new Date().getFullYear();
  let full = false;
  let from: number | undefined;
  let to: number | undefined;
  let games = true;
  let minor = true;
  for (const a of argv) {
    if (a === "--full") full = true;
    else if (a === "--no-games") games = false;
    else if (a === "--minor") minor = true;
    else if (a === "--no-minor") minor = false;
    else if (a.startsWith("--from=")) from = Number(a.slice(7));
    else if (a.startsWith("--to=")) to = Number(a.slice(5));
  }
  let years: number[];
  if (from || to) {
    const lo = from ?? FIRST_YEAR;
    const hi = to ?? now;
    years = range(lo, hi);
  } else if (full) {
    years = range(FIRST_YEAR, now);
  } else {
    years = [now]; // 增量：仅当年
  }
  return { years, games, minor };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

async function fetchMatches(tournaments: TournamentInfo[]): Promise<CargoRow[]> {
  const pages = tournaments.map((t) => t.overviewPage);
  const rows: CargoRow[] = [];
  const BATCH = 25;
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const clause = batch.map((p) => `OverviewPage="${p.replace(/"/g, '\\"')}"`).join(" OR ");
    const part = await cargoQueryAll({
      tables: "MatchSchedule",
      fields: MATCH_FIELDS,
      where: clause,
      order_by: "DateTime_UTC",
    });
    rows.push(...part);
    console.log(`  [matches] ${Math.min(i + BATCH, pages.length)}/${pages.length} 赛事，累计 ${rows.length} 场`);
  }
  return rows;
}

async function fetchGames(tournaments: TournamentInfo[]): Promise<CargoRow[]> {
  const pages = tournaments.map((t) => t.overviewPage);
  const rows: CargoRow[] = [];
  const BATCH = 25;
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const clause = batch.map((p) => `OverviewPage="${p.replace(/"/g, '\\"')}"`).join(" OR ");
    const part = await cargoQueryAll({ tables: "MatchScheduleGame", fields: GAME_FIELDS, where: clause });
    rows.push(...part);
  }
  return rows;
}

function writeJson(name: string, data: unknown) {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data), "utf8");
}

function readExistingTeams(): Map<string, Team> {
  const p = join(DATA_DIR, "teams.json");
  const map = new Map<string, Team>();
  if (existsSync(p)) {
    for (const t of JSON.parse(readFileSync(p, "utf8")) as Team[]) map.set(t.canonical_id, t);
  }
  return map;
}

function buildTeams(
  series: Series[],
  tByPage: Map<string, TournamentInfo>,
  rawByCanonical: Map<string, Set<string>>,
  overrides: OverridesFile,
  existing: Map<string, Team>,
): Team[] {
  const region = new Map<string, string>();
  for (const s of series) {
    const t = tByPage.get(s.tournament);
    if (t && t.regionTag && t.regionTag !== "International") {
      if (!region.has(s.t1)) region.set(s.t1, t.regionTag);
      if (!region.has(s.t2)) region.set(s.t2, t.regionTag);
    }
  }
  const ids = new Set<string>([...rawByCanonical.keys(), ...existing.keys()]);
  const teams: Team[] = [];
  for (const id of ids) {
    const prev = existing.get(id);
    const aliases = new Set<string>(prev?.aliases ?? []);
    for (const a of rawByCanonical.get(id) ?? []) if (a !== id) aliases.add(a);
    const ov = overrides.teams?.[id];
    teams.push({
      canonical_id: id,
      display_name: ov?.display_name ?? prev?.display_name ?? id,
      aliases: [...aliases].sort(),
      region: ov?.region ?? region.get(id) ?? prev?.region ?? "",
    });
  }
  return teams.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));
}

async function main() {
  const args = parseArgs();
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`抓取年份：${args.years.join(", ")}｜逐局：${args.games}｜小赛区：${args.minor}`);

  const overrides = loadOverrides();
  const leagues = await fetchTargetLeagues(args.minor);

  // 逐年抓取并写分片
  const allSeries: Series[] = [];
  const rawByCanonical = new Map<string, Set<string>>();
  const tByPage = new Map<string, TournamentInfo>();
  const allYearsSet = new Set<number>();

  for (const year of args.years) {
    console.log(`\n=== ${year} ===`);
    const tournaments = await fetchTournaments([year], leagues);
    if (!tournaments.length) {
      console.log("  无目标赛事，跳过");
      continue;
    }
    for (const t of tournaments) tByPage.set(t.overviewPage, t);

    const matchRows = await fetchMatches(tournaments);
    // 收集原始队名，构建解析器
    const rawNames = new Set<string>();
    for (const r of matchRows) {
      if (r.Team1) rawNames.add(r.Team1.trim());
      if (r.Team2) rawNames.add(r.Team2.trim());
    }
    const resolver = await buildResolver(rawNames, overrides);
    for (const raw of rawNames) {
      const canon = resolver.resolve(raw);
      if (!rawByCanonical.has(canon)) rawByCanonical.set(canon, new Set());
      rawByCanonical.get(canon)!.add(raw);
    }

    const series: Series[] = [];
    for (const r of matchRows) {
      const t = tByPage.get(r.OverviewPage);
      if (!t) continue;
      const s = rowToSeries(r, t, resolver);
      if (s) series.push(s);
    }
    series.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    writeJson(`series-${year}.json`, series);
    console.log(`  写出 series-${year}.json：${series.length} 场`);
    allSeries.push(...series);
    if (series.length) allYearsSet.add(year);

    if (args.games) {
      const gameRows = await fetchGames(tournaments);
      const seriesIds = new Set(series.map((s) => s.id));
      const games: Game[] = [];
      for (const r of gameRows) {
        const g = rowToGame(r, resolver);
        if (g && seriesIds.has(g.series_id)) games.push(g);
      }
      writeJson(`games-${year}.json`, games);
      console.log(`  写出 games-${year}.json：${games.length} 局`);
    }
  }

  // teams.json：合并既有（保留其他年份积累的别名）
  const existing = readExistingTeams();
  const teams = buildTeams(allSeries, tByPage, rawByCanonical, overrides, existing);
  writeJson("teams.json", teams);
  console.log(`\n写出 teams.json：${teams.length} 支战队`);

  // index.json：合并已存在的年份
  const idxPath = join(DATA_DIR, "index.json");
  const prevYears: number[] = existsSync(idxPath)
    ? (JSON.parse(readFileSync(idxPath, "utf8")) as DataIndex).years ?? []
    : [];
  const years = [...new Set([...prevYears, ...allYearsSet])].sort((a, b) => a - b);
  const index: DataIndex = {
    years,
    counts: { series: allSeries.length, teams: teams.length },
    generated_at: new Date().toISOString(),
    regions: [...new Set(teams.map((t) => t.region).filter(Boolean))].sort(),
  };
  writeJson("index.json", index);
  console.log(`写出 index.json：years=${years.join(",")}`);
  console.log("\n完成。");
}

main().catch((e) => {
  console.error("抓取失败：", e);
  process.exit(1);
});
