// 加载 public/data 下的 JSON 分片，建索引。
import type { Series, Team, DataIndex } from "../shared/types";

export interface Dataset {
  series: Series[];
  teams: Team[];
  teamById: Map<string, Team>;
  index: DataIndex;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const base = import.meta.env.BASE_URL;
  const index = await fetchJson<DataIndex>(`${base}data/index.json`);
  const teams = await fetchJson<Team[]>(`${base}data/teams.json`);
  const shards = await Promise.all(
    (index.years ?? []).map((y) =>
      fetchJson<Series[]>(`${base}data/series-${y}.json`).catch(() => [] as Series[]),
    ),
  );
  const series = shards.flat();
  const teamById = new Map(teams.map((t) => [t.canonical_id, t]));
  return { series, teams, teamById, index };
}

/** 显示名：优先 team 展示名，回退 id。 */
export function displayName(teams: Map<string, Team>, id: string): string {
  return teams.get(id)?.display_name ?? id;
}
