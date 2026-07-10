// 逐局数据（games-YYYY.json）按需加载，仅在用户展开时拉取，按年缓存。
import type { Game } from "../shared/types";

const cache = new Map<string, Promise<Game[]>>();

function loadYear(year: string): Promise<Game[]> {
  let p = cache.get(year);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/games-${year}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Game[]>) : []))
      .catch(() => []);
    cache.set(year, p);
  }
  return p;
}

/** 取某 series 的逐局记录（可能为空——旧数据或未抓逐局）。 */
export async function gamesOfSeries(seriesId: string, date: string): Promise<Game[]> {
  const year = date.slice(0, 4);
  const games = await loadYear(year);
  return games
    .filter((g) => g.series_id === seriesId)
    .sort((a, b) => a.game_n - b.game_n);
}
