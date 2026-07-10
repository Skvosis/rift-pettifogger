// 从 data/*.csv（Oracle's Elixir）构建 public/data 的 JSON。
// 用法：
//   npm run data:build                    → 构建 data/ 下所有年份
//   npm run data:build -- --years=2026    → 只重建指定年份（增量；teams/index 全局合并更新）
//   npm run data:build -- --years=2021-2024
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LEAGUE_INFO, readTeamRows, type OeGameRow } from "./oe.ts";
import type { DataIndex, Game, OverridesFile, Series, SeriesFlag, Team } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_DIR = join(__dirname, "..", "data");
const OUT_DIR = join(__dirname, "..", "public", "data");
const csvName = (y: number) => `${y}_LoL_esports_match_data_from_OraclesElixir.csv`;

/** 同一 series 内两局最大间隔（小时）——跨午夜的 Bo5 也不会超过它。 */
const MAX_GAP_HOURS = 36;

// ---------- 参数 ----------
function parseYears(): number[] {
  const arg = process.argv.find((a) => a.startsWith("--years="))?.slice(8);
  if (!arg) {
    return readdirSync(CSV_DIR)
      .map((f) => /^(\d{4})_LoL_esports/.exec(f)?.[1])
      .filter((y): y is string => !!y)
      .map(Number)
      .sort();
  }
  const m = /^(\d{4})(?:-(\d{4}))?$/.exec(arg);
  if (!m) throw new Error(`--years 参数无效: ${arg}`);
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

// ---------- 归并 ----------
function loadOverrides(): OverridesFile {
  const raw = JSON.parse(readFileSync(join(OUT_DIR, "overrides.json"), "utf8"));
  return { merge: raw.merge ?? {}, teams: raw.teams ?? {} };
}

const toIso = (d: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(d);
  return m ? `${m[1]}T${m[2]}Z` : null;
};

// ---------- series 重建 ----------
interface GamePair {
  gameid: string;
  league: string;
  split: string;
  playoffs: boolean;
  date: string; // ISO
  gameN: number;
  blue: string; // canonical
  red: string;
  winner: string;
}

function pairGames(rows: OeGameRow[], resolve: (n: string) => string): GamePair[] {
  const byGame = new Map<string, OeGameRow[]>();
  for (const r of rows) {
    const arr = byGame.get(r.gameid);
    if (arr) arr.push(r);
    else byGame.set(r.gameid, [r]);
  }
  const out: GamePair[] = [];
  for (const [gameid, pair] of byGame) {
    if (pair.length !== 2) continue; // 数据不完整
    const blueRow = pair.find((r) => r.side === "Blue");
    const redRow = pair.find((r) => r.side === "Red");
    if (!blueRow || !redRow) continue;
    if (blueRow.result === redRow.result) continue; // 无效（无胜者）
    const date = toIso(blueRow.date);
    if (!date) continue;
    const blue = resolve(blueRow.teamname);
    const red = resolve(redRow.teamname);
    if (!blue || !red || blue === red) continue;
    out.push({
      gameid,
      league: blueRow.league,
      split: blueRow.split,
      playoffs: blueRow.playoffs,
      date,
      gameN: blueRow.game,
      blue,
      red,
      winner: blueRow.result === 1 ? blue : red,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.gameN - b.gameN);
}

function inferBestOf(w1: number, w2: number): number {
  const total = w1 + w2;
  const maxW = Math.max(w1, w2);
  if (total === 1) return 1;
  if (w1 === 1 && w2 === 1) return 2; // Bo2 平局
  if (maxW === 2) return 3;
  if (maxW >= 3) return 2 * maxW - 1;
  return total;
}

function tournamentLabel(g: GamePair, year: number): string {
  const info = LEAGUE_INFO[g.league];
  if (info.tier !== "domestic") return `${g.league} ${year}`; // "WLDs 2024" / "MSI 2024"
  const split = g.split ? ` ${g.split}` : "";
  return `${g.league} ${year}${split}${g.playoffs ? " Playoffs" : ""}`;
}

function buildYear(games: GamePair[], year: number): { series: Series[]; games: Game[] } {
  // 按 (联赛|阶段|队对) 分组，组内按时间切分 series
  const groups = new Map<string, GamePair[]>();
  for (const g of games) {
    const pk = [g.blue, g.red].sort().join("|");
    const key = `${g.league}|${g.split}|${g.playoffs}|${pk}`;
    const arr = groups.get(key);
    if (arr) arr.push(g);
    else groups.set(key, [g]);
  }

  const series: Series[] = [];
  const gameOut: Game[] = [];
  for (const list of groups.values()) {
    // list 已随全局排序保持时间序
    let cur: GamePair[] = [];
    const flush = () => {
      if (!cur.length) return;
      const [a, b] = [cur[0].blue, cur[0].red].sort();
      const wa = cur.filter((g) => g.winner === a).length;
      const wb = cur.length - wa;
      const first = cur[0];
      series.push({
        id: first.gameid,
        date: first.date,
        tournament: tournamentLabel(first, year),
        tier: LEAGUE_INFO[first.league].tier,
        best_of: inferBestOf(wa, wb),
        t1: a,
        t2: b,
        s1: wa,
        s2: wb,
        flags: [] as SeriesFlag[],
      });
      cur.forEach((g, i) =>
        gameOut.push({ series_id: first.gameid, game_n: i + 1, winner: g.winner, blue: g.blue, red: g.red }),
      );
      cur = [];
    };
    for (const g of list) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const gapH = (Date.parse(g.date) - Date.parse(prev.date)) / 3.6e6;
        // 局号回退/重复 或 时间断档 → 新 series
        if (g.gameN <= prev.gameN || gapH > MAX_GAP_HOURS) flush();
      }
      cur.push(g);
    }
    flush();
  }
  series.sort((a, b) => a.date.localeCompare(b.date));
  return { series, games: gameOut };
}

// ---------- teams / index ----------
function rebuildTeams(overrides: OverridesFile): Team[] {
  // 汇总磁盘上所有 series 分片（含刚写出的），保证增量构建时 teams 全局一致
  const region = new Map<string, Map<string, number>>(); // id -> region -> 次数
  const ids = new Set<string>();
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^series-(\d{4})\.json$/.exec(f);
    if (!m) continue;
    const shard = JSON.parse(readFileSync(join(OUT_DIR, f), "utf8")) as Series[];
    for (const s of shard) {
      ids.add(s.t1);
      ids.add(s.t2);
      if (s.tier !== "domestic") continue;
      const league = Object.keys(LEAGUE_INFO)
        .filter((l) => s.tournament.startsWith(l + " "))
        .sort((a, b) => b.length - a.length)[0];
      if (!league) continue;
      const r = LEAGUE_INFO[league].region;
      for (const id of [s.t1, s.t2]) {
        let counts = region.get(id);
        if (!counts) region.set(id, (counts = new Map()));
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
  }
  // 别名：overrides.merge 中指向该 id 的键 + 手工 aliases
  const mergedAliases = new Map<string, string[]>();
  for (const [from, to] of Object.entries(overrides.merge)) {
    if (!mergedAliases.has(to)) mergedAliases.set(to, []);
    mergedAliases.get(to)!.push(from);
  }
  const teams: Team[] = [];
  for (const id of ids) {
    const counts = region.get(id);
    const topRegion = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
    const ov = overrides.teams?.[id];
    const aliases = [...new Set([...(mergedAliases.get(id) ?? []), ...(ov?.aliases ?? [])])];
    teams.push({
      canonical_id: id,
      display_name: ov?.display_name ?? id,
      aliases,
      region: ov?.region ?? topRegion,
    });
  }
  return teams.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));
}

function rebuildIndex(teamsCount: number): DataIndex {
  const years: number[] = [];
  let seriesCount = 0;
  let gamesCount = 0;
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^series-(\d{4})\.json$/.exec(f);
    if (m) {
      const shard = JSON.parse(readFileSync(join(OUT_DIR, f), "utf8")) as Series[];
      if (shard.length) {
        years.push(Number(m[1]));
        seriesCount += shard.length;
      }
    }
    const g = /^games-(\d{4})\.json$/.exec(f);
    if (g) gamesCount += (JSON.parse(readFileSync(join(OUT_DIR, f), "utf8")) as Game[]).length;
  }
  return {
    years: years.sort((a, b) => a - b),
    counts: { series: seriesCount, teams: teamsCount, games: gamesCount },
    generated_at: new Date().toISOString(),
    regions: undefined,
  };
}

// ---------- 主流程 ----------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const years = parseYears();
  const overrides = loadOverrides();
  const resolve = (name: string) => overrides.merge[name] ?? name;

  for (const year of years) {
    const file = join(CSV_DIR, csvName(year));
    if (!existsSync(file)) {
      console.warn(`[${year}] 缺少 CSV：${file}，跳过`);
      continue;
    }
    const rows = await readTeamRows(file);
    const games = pairGames(rows, resolve);
    const { series, games: gameRows } = buildYear(games, year);
    writeFileSync(join(OUT_DIR, `series-${year}.json`), JSON.stringify(series));
    writeFileSync(join(OUT_DIR, `games-${year}.json`), JSON.stringify(gameRows));
    console.log(`[${year}] ${series.length} series / ${gameRows.length} games`);
  }

  const teams = rebuildTeams(overrides);
  writeFileSync(join(OUT_DIR, "teams.json"), JSON.stringify(teams));
  const index = rebuildIndex(teams.length);
  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index));
  console.log(`teams: ${teams.length}｜years: ${index.years.join(",")}｜series 总数: ${index.counts.series}`);
}

main().catch((e) => {
  console.error("构建失败：", e);
  process.exit(1);
});
