// 嘴硬模式（M5）：在离散过滤器空间中搜索能让 A>B 成立的组合，按“改动最小 + 链最强”推荐。
import type { Series } from "../../shared/types";
import type { CrossFormat, Filters, Scope, Tally } from "./types";
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
const CHAIN_LENS = [3, 5, 7];

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
  // 只向放宽方向尝试：关闭→仅零封＞打满→全档位
  const crossFormats = uniq<CrossFormat>([base.crossFormat, "strict", "loose"]);
  const chainLens = uniq([base.maxChainLen, ...CHAIN_LENS.filter((n) => n > base.maxChainLen)]);
  const starts = uniq([base.start, null]);

  // 生成组合并按“改动数”升序，优先推荐最小改动
  const combos: Filters[] = [];
  for (const scope of scopes)
    for (const tally of tallies)
      for (const proximityDays of proxes)
        for (const crossFormat of crossFormats)
          for (const maxChainLen of chainLens)
            for (const start of starts)
              combos.push({ ...base, scope, tally, proximityDays, crossFormat, maxChainLen, start });

  combos.sort((x, y) => changeCount(base, x) - changeCount(base, y));

  const found: Suggestion[] = [];
  const seen = new Set<string>();
  let evaluated = 0;
  for (const f of combos) {
    if (found.length >= maxSuggestions || evaluated >= 80) break;
    const sig = `${f.scope}|${f.tally}|${f.proximityDays}|${f.crossFormat}|${f.maxChainLen}|${f.start}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (changeCount(base, f) === 0) continue; // 当前设置已在页面上判过
    evaluated++;
    const edges = buildEdges(series, f);
    // 只做存在性检查（取前 5 条），不做全量枚举
    const args = findArguments(a, b, edges, 5, f.maxChainLen);
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

const XF_LABEL: Record<CrossFormat, string> = {
  off: "关闭",
  strict: "仅零封＞打满",
  loose: "全档位",
};

function changeLabels(base: Filters, f: Filters): string[] {
  const labels: string[] = [];
  if (f.scope !== base.scope) labels.push(`赛事范围→${SCOPE_LABEL[f.scope]}`);
  if (f.tally !== base.tally) labels.push(`口径→${f.tally === "game" ? "小局" : "大局"}`);
  if (f.proximityDays !== base.proximityDays) labels.push(`邻近窗口→${f.proximityDays}天`);
  if (f.crossFormat !== base.crossFormat) labels.push(`跨赛制→${XF_LABEL[f.crossFormat]}`);
  if (f.maxChainLen !== base.maxChainLen) labels.push(`链长→${f.maxChainLen >= 7 ? "不限" : f.maxChainLen}`);
  if (f.start !== base.start) labels.push(f.start ? `起始→${f.start}` : "清除起始时间");
  return labels;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
