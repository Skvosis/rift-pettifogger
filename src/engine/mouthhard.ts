// 嘴硬模式（M5）：在离散过滤器空间中搜索能让 A>B 成立的组合，按“改动最小 + 链最强”推荐。
import type { Series } from "../../shared/types";
import type { Filters, Scope, Tally } from "./types";
import { buildEdges, findArguments } from "./graph";

export interface Suggestion {
  filters: Filters;
  /** 相对当前过滤器改动了几个维度。 */
  changes: number;
  /** 改动的人类可读描述。 */
  changeLabels: string[];
  /** 最强论证的链强度。 */
  bestStrength: number;
  /** 找到的论证数。 */
  count: number;
  /** 最短论证的跳数。 */
  shortest: number;
}

const SCOPES: Scope[] = ["all", "international", "worlds"];
const TALLIES: Tally[] = ["series", "game"];
const PROXES = [90, 365, 3650];

/** 搜索让 A>B 成立的过滤器组合。base 为用户当前设置。 */
export function findWinningFilters(
  series: Series[],
  a: string,
  b: string,
  base: Filters,
  maxSuggestions = 6,
): Suggestion[] {
  const scopes = uniq([base.scope, ...SCOPES]);
  const tallies = uniq([base.tally, ...TALLIES]);
  const proxes = uniq([base.proximityDays, ...PROXES]);
  const stricts = [false, true];
  const starts = uniq([base.start, null]);

  // 生成组合并按“改动数”升序，优先推荐最小改动
  const combos: Filters[] = [];
  for (const scope of scopes)
    for (const tally of tallies)
      for (const proximityDays of proxes)
        for (const strict of stricts)
          for (const start of starts)
            combos.push({ ...base, scope, tally, proximityDays, strict, start });

  combos.sort((x, y) => changeCount(base, x) - changeCount(base, y));

  const found: Suggestion[] = [];
  const seen = new Set<string>();
  let evaluated = 0;
  for (const f of combos) {
    if (found.length >= maxSuggestions || evaluated >= 60) break;
    const sig = `${f.scope}|${f.tally}|${f.proximityDays}|${f.strict}|${f.start}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (changeCount(base, f) === 0) continue; // 当前设置已在页面上判过
    evaluated++;
    const edges = buildEdges(series, f);
    const args = findArguments(a, b, edges);
    if (!args.length) continue;
    found.push({
      filters: f,
      changes: changeCount(base, f),
      changeLabels: changeLabels(base, f),
      bestStrength: Math.max(...args.map((x) => x.chainStrength)),
      count: args.length,
      shortest: Math.min(...args.map((x) => x.path.length)),
    });
  }

  found.sort(
    (x, y) => x.changes - y.changes || x.shortest - y.shortest || y.bestStrength - x.bestStrength,
  );
  return found.slice(0, maxSuggestions);
}

function changeCount(base: Filters, f: Filters): number {
  return changeLabels(base, f).length;
}

const SCOPE_LABEL: Record<Scope, string> = {
  all: "全部赛事",
  international: "国际赛",
  worlds: "仅 Worlds",
};

function changeLabels(base: Filters, f: Filters): string[] {
  const labels: string[] = [];
  if (f.scope !== base.scope) labels.push(`赛事范围→${SCOPE_LABEL[f.scope]}`);
  if (f.tally !== base.tally) labels.push(`口径→${f.tally === "game" ? "小局" : "大局"}`);
  if (f.proximityDays !== base.proximityDays) labels.push(`邻近窗口→${f.proximityDays}天`);
  if (f.strict !== base.strict) labels.push(f.strict ? "开启严格模式" : "关闭严格模式");
  if (f.start !== base.start) labels.push(f.start ? `起始→${f.start}` : "清除起始时间");
  return labels;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
