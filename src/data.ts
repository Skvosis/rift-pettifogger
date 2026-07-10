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

// ---------- 战队模糊搜索 ----------

export interface SearchEntry {
  team: Team;
  haystack: string;
}

export function buildSearchIndex(teams: Team[]): SearchEntry[] {
  return teams.map((t) => ({
    team: t,
    haystack: [t.display_name, t.canonical_id, ...t.aliases].join(" ").toLowerCase(),
  }));
}

/** 简单子串 + 词首匹配打分搜索，返回按相关度排序的前 n 支队。 */
export function searchTeams(index: SearchEntry[], query: string, n = 8): Team[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { team: Team; score: number }[] = [];
  for (const e of index) {
    const name = e.team.display_name.toLowerCase();
    let score = 0;
    if (name === q) score = 1000;
    else if (name.startsWith(q)) score = 500;
    else if (e.haystack.includes(` ${q}`)) score = 200;
    else if (e.haystack.includes(q)) score = 100;
    if (score > 0) {
      score -= name.length * 0.1; // 越短越优先
      scored.push({ team: e.team, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.team);
}
