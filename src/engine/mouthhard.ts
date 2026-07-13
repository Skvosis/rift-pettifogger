// 嘴硬模式（M5）：在离散过滤器空间中搜索能让 A>B 成立的组合，按“改动最小 + 链最强”推荐。
import type { Series } from "../../shared/types";
import type { CrossFormat, Filters, FilterChange, Scope, Tally } from "./types";
import { buildEdges, findArguments } from "./graph";
import { CHAIN_LEN_UNLIMITED } from "./filters";

export interface Suggestion {
  filters: Filters;
  /** 相对当前过滤器的改动（语言无关，UI 层用 i18n 格式化）。 */
  changes: FilterChange[];
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
const CHAIN_LENS = [5, 8, CHAIN_LEN_UNLIMITED];

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

  combos.sort((x, y) => computeChanges(base, x).length - computeChanges(base, y).length);

  const found: Suggestion[] = [];
  const seen = new Set<string>();
  let evaluated = 0;
  for (const f of combos) {
    if (found.length >= maxSuggestions || evaluated >= 80) break;
    const sig = `${f.scope}|${f.tally}|${f.proximityDays}|${f.crossFormat}|${f.maxChainLen}|${f.start}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const changes = computeChanges(base, f);
    if (!changes.length) continue; // 当前设置已在页面上判过
    evaluated++;
    const edges = buildEdges(series, f);
    // 只做存在性检查（取前 5 条），不做全量枚举
    const args = findArguments(a, b, edges, 5, f.maxChainLen);
    if (!args.length) continue;
    found.push({
      filters: f,
      changes,
      bestStrength: Math.max(...args.map((x) => x.chainStrength)),
      count: args.length,
      shortest: Math.min(...args.map((x) => x.path.length)),
    });
  }

  found.sort(
    (x, y) =>
      x.changes.length - y.changes.length || x.shortest - y.shortest || y.bestStrength - x.bestStrength,
  );
  return found.slice(0, maxSuggestions);
}

/** 相对 base 有哪些维度发生了变化（语言无关的结构化列表）。 */
function computeChanges(base: Filters, f: Filters): FilterChange[] {
  const out: FilterChange[] = [];
  if (f.scope !== base.scope) out.push({ kind: "scope", value: f.scope });
  if (f.tally !== base.tally) out.push({ kind: "tally", value: f.tally });
  if (f.proximityDays !== base.proximityDays) out.push({ kind: "proximity", days: f.proximityDays });
  if (f.crossFormat !== base.crossFormat) out.push({ kind: "crossFormat", value: f.crossFormat });
  if (f.maxChainLen !== base.maxChainLen) out.push({ kind: "maxChainLen", value: f.maxChainLen });
  if (f.start !== base.start) out.push({ kind: "start", value: f.start });
  return out;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
