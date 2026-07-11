// 图搜索：用规则 1–3 产的边建有向图，枚举 A→B 简单路径（规则 4），含反方视角与放宽建议。
import type { Series } from "../../shared/types";
import type { Argument, Edge, Filters, Verdict } from "./types";
import { rule1, rule2All, rule3 } from "./rules";
import { QUALITY, inTimeWindow } from "./types";

// 枚举上限，防止稠密图爆炸（仍足以覆盖“展示前 5 条”的需求）。
const MAX_DEPTH = 7;
const MAX_EXPANSIONS = 60000;
const MAX_RESULTS = 300;

const key = (from: string, to: string) => `${from} ${to}`;

/** 边集缓存：同一数据集 + 同一过滤器签名直接复用（嘴硬模式会反复建图）。 */
const edgeCache = new WeakMap<Series[], Map<string, Edge[]>>();

/** 只含影响边集的字段（链长上限只影响搜索，不参与签名）。 */
function filterSig(f: Filters): string {
  return `${f.start}|${f.end}|${f.scope}|${f.tally}|${f.proximityDays}|${f.crossFormat}`;
}

/**
 * 构建当前过滤器下的全部边（带缓存）。
 * 规则 1/3 按“有交手的队对”遍历；规则 2 走全局共同对手枚举。
 */
export function buildEdges(all: Series[], filters: Filters): Edge[] {
  let byFilter = edgeCache.get(all);
  if (!byFilter) edgeCache.set(all, (byFilter = new Map()));
  const sig = filterSig(filters);
  const hit = byFilter.get(sig);
  if (hit) return hit;
  const edges = computeEdges(all, filters);
  if (byFilter.size > 40) byFilter.clear();
  byFilter.set(sig, edges);
  return edges;
}

function computeEdges(all: Series[], filters: Filters): Edge[] {
  const windowed = all.filter((s) => inTimeWindow(s, filters));
  const edges: Edge[] = [];

  // 按无序队对分组一次，避免每对都全表扫描
  const pairSeries = new Map<string, { a: string; b: string; list: Series[] }>();
  for (const s of windowed) {
    const [x, y] = s.t1 < s.t2 ? [s.t1, s.t2] : [s.t2, s.t1];
    const k = key(x, y);
    let entry = pairSeries.get(k);
    if (!entry) pairSeries.set(k, (entry = { a: x, b: y, list: [] }));
    entry.list.push(s);
  }
  for (const { a, b, list } of pairSeries.values()) {
    const e1 = rule1(list, a, b, filters);
    if (e1) edges.push(e1);
    // 规则 3 两个方向至多一个成立
    const e3ab = rule3(list, a, b, filters);
    if (e3ab) edges.push(e3ab);
    const e3ba = rule3(list, b, a, filters);
    if (e3ba) edges.push(e3ba);
  }

  edges.push(...rule2All(all, filters));
  return edges;
}

/** 判案：正方 A>B 与反方 B>A。链长上限取自过滤器。 */
export function judge(all: Series[], a: string, b: string, filters: Filters): Verdict {
  const edges = buildEdges(all, filters);
  const maxDepth = clampDepth(filters.maxChainLen);
  const forward = findArguments(a, b, edges, MAX_RESULTS, maxDepth);
  const reverse = findArguments(b, a, edges, MAX_RESULTS, maxDepth);
  const verdict: Verdict = { a, b, forward, reverse };
  if (!forward.length) verdict.hint = suggestRelaxation(all, a, b, filters);
  return verdict;
}

function clampDepth(n: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DEPTH) : MAX_DEPTH;
}

/**
 * 从已建好的边集里找 A→B 的全部论证（直接 + 传递链），强度优先排序。
 * maxResults 供嘴硬模式做存在性检查；maxDepth 为链长上限（边数）。
 */
export function findArguments(
  a: string,
  b: string,
  edges: Edge[],
  maxResults = MAX_RESULTS,
  maxDepth = MAX_DEPTH,
): Argument[] {
  // 直接边：每条规则各作为一条 length-1 论证
  const direct = edges.filter((e) => e.from === a && e.to === b);
  const args: Argument[] = direct.map((e) => ({ path: [e], chainStrength: chainScore([e]) }));

  // 传递链：每个有向对取最强边建简单图
  const best = new Map<string, Edge>();
  for (const e of edges) {
    const k = key(e.from, e.to);
    const cur = best.get(k);
    if (!cur || e.strength > cur.strength) best.set(k, e);
  }
  const adj = new Map<string, Edge[]>();
  for (const e of best.values()) push(adj, e.from, e);

  // 迭代 DFS 枚举简单路径（长度 ≥ 2），按扩展数封顶
  const depthCap = clampDepth(maxDepth);
  let expansions = 0;
  const stack: { node: string; path: Edge[]; visited: Set<string> }[] = [
    { node: a, path: [], visited: new Set([a]) },
  ];
  while (stack.length && args.length < maxResults && expansions < MAX_EXPANSIONS) {
    const { node, path, visited } = stack.pop()!;
    if (path.length >= depthCap) continue;
    for (const e of adj.get(node) ?? []) {
      expansions++;
      if (visited.has(e.to)) continue;
      const nextPath = [...path, e];
      if (e.to === b) {
        if (nextPath.length >= 2) {
          args.push({ path: nextPath, chainStrength: chainScore(nextPath) });
        }
        continue; // 到达 B 即停（简单路径不再延伸）
      }
      const nextVisited = new Set(visited);
      nextVisited.add(e.to);
      stack.push({ node: e.to, path: nextPath, visited: nextVisited });
    }
  }

  // 含金量优先，同分再比链长
  args.sort((x, y) => y.chainStrength - x.chainStrength || x.path.length - y.path.length);
  return args;
}

/** 链条得分 = 最弱一环的含金量 × 每多一环的折扣（长链天然弱于短链，但强链可胜过弱的短链）。 */
function chainScore(path: Edge[]): number {
  const minQ = path.reduce((m, e) => Math.min(m, e.strength), Infinity);
  return minQ * Math.pow(QUALITY.chainDecay, path.length - 1);
}

/** 正方无路径时，给出最可能有戏的放宽建议。 */
function suggestRelaxation(all: Series[], a: string, b: string, f: Filters): string {
  const anyA = all.some((s) => s.t1 === a || s.t2 === a);
  const anyB = all.some((s) => s.t1 === b || s.t2 === b);
  if (!anyA || !anyB) {
    return "数据中缺少其中一支战队的比赛记录，请确认选择或等待数据更新。";
  }
  const tips: string[] = [];
  if (f.start) tips.push("清除“起始时间”以纳入更早的交手（默认只看最近三个月）");
  if (f.maxChainLen < MAX_DEPTH) tips.push("放宽“链长上限”");
  if (f.scope !== "all") tips.push("把“赛事范围”放宽到全部");
  if (f.crossFormat !== "loose") tips.push("把“跨赛制对比”放宽到全档位");
  if (f.proximityDays < 180) tips.push("调大“邻近窗口”让共同对手更易匹配");
  if (f.tally === "series") tips.push("切换到“小局”口径");
  if (!tips.length) return "当前过滤器下找不到任何论据链——已是最宽松设置，这盘确实不好洗。";
  return "找不到论据链。可尝试：" + tips.join("；") + "。";
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}
