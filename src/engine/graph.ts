// 图搜索：用规则 1–3 产的边建有向图，枚举 A→B 简单路径（规则 4），含反方视角与放宽建议。
import type { Series } from "../../shared/types";
import type { Argument, Edge, Filters, Hint, TipKey, Verdict } from "./types";
import { rule1, rule2All, rule3 } from "./rules";
import { QUALITY, inTimeWindow } from "./types";
import { CHAIN_LEN_UNLIMITED } from "./filters";

// 枚举上限，防止稠密图爆炸（仍足以覆盖“展示前 5 条”的需求）。
/** 物理边数硬上限（DFS 安全阀，与用户声明的层数上限是两回事，见 findArguments）。 */
const MAX_DEPTH = 8;
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
  const forward = findArguments(a, b, edges, MAX_RESULTS, filters.maxChainLen);
  const reverse = findArguments(b, a, edges, MAX_RESULTS, filters.maxChainLen);
  const verdict: Verdict = { a, b, forward, reverse };
  if (!forward.length) verdict.hint = suggestRelaxation(all, a, b, filters);
  return verdict;
}

/**
 * 从已建好的边集里找 A→B 的全部论证（直接 + 传递链），强度优先排序。
 * maxResults 供嘴硬模式做存在性检查；maxLayers 为有效层数上限（1–8 真实档位，
 * 或 CHAIN_LEN_UNLIMITED 哨兵——其值远大于物理可达层数，天然等同"不限"，无需特判）。
 */
export function findArguments(
  a: string,
  b: string,
  edges: Edge[],
  maxResults = MAX_RESULTS,
  maxLayers = CHAIN_LEN_UNLIMITED,
): Argument[] {
  const layerCap = Number.isFinite(maxLayers) && maxLayers >= 1 ? maxLayers : CHAIN_LEN_UNLIMITED;
  // 直接边：每条规则各作为一条论证（规则 2 计 2 层，受链长上限约束）
  const direct = edges.filter((e) => e.from === a && e.to === b && edgeLayers(e) <= layerCap);
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

  // 迭代 DFS 枚举简单路径（长度 ≥ 2），按扩展数封顶；
  // 层数上限按"有效层"计（规则 2 记 2 层），物理边数始终受引擎硬上限约束
  let expansions = 0;
  const stack: { node: string; path: Edge[]; visited: Set<string>; layers: number }[] = [
    { node: a, path: [], visited: new Set([a]), layers: 0 },
  ];
  while (stack.length && args.length < maxResults && expansions < MAX_EXPANSIONS) {
    const { node, path, visited, layers } = stack.pop()!;
    if (path.length >= MAX_DEPTH) continue;
    for (const e of adj.get(node) ?? []) {
      expansions++;
      if (visited.has(e.to)) continue;
      const nextLayers = layers + edgeLayers(e);
      if (nextLayers > layerCap) continue;
      const nextPath = [...path, e];
      if (e.to === b) {
        if (nextPath.length >= 2) {
          args.push({ path: nextPath, chainStrength: chainScore(nextPath) });
        }
        continue; // 到达 B 即停（简单路径不再延伸）
      }
      const nextVisited = new Set(visited);
      nextVisited.add(e.to);
      stack.push({ node: e.to, path: nextPath, visited: nextVisited, layers: nextLayers });
    }
  }

  // 含金量优先，同分再比链长
  args.sort((x, y) => y.chainStrength - x.chainStrength || x.path.length - y.path.length);
  return args;
}

/** 单边的有效层数：规则 2 借道共同对手做小分对比，视作额外经过一层传递。 */
function edgeLayers(e: Edge): number {
  return e.rule === 2 ? 2 : 1;
}

/** 链条得分 = 最弱一环的含金量 × 每多一有效层的折扣（长链天然弱于短链，但强链可胜过弱的短链）。 */
function chainScore(path: Edge[]): number {
  const minQ = path.reduce((m, e) => Math.min(m, e.strength), Infinity);
  const layers = path.reduce((sum, e) => sum + edgeLayers(e), 0);
  return minQ * Math.pow(QUALITY.chainDecay, layers - 1);
}

/** 正方无路径时，给出最可能有戏的放宽建议（结构化，UI 层用 i18n 格式化）。 */
function suggestRelaxation(all: Series[], a: string, b: string, f: Filters): Hint {
  const anyA = all.some((s) => s.t1 === a || s.t2 === a);
  const anyB = all.some((s) => s.t1 === b || s.t2 === b);
  if (!anyA || !anyB) return { kind: "missingData" };
  const tips: TipKey[] = [];
  if (f.start) tips.push("clearStart");
  if (f.maxChainLen < CHAIN_LEN_UNLIMITED) tips.push("widenChainLen");
  if (f.scope !== "all") tips.push("widenScope");
  if (f.crossFormat !== "loose") tips.push("widenCrossFormat");
  if (f.proximityDays < 180) tips.push("widenProximity");
  if (f.tally === "series") tips.push("switchTally");
  if (!tips.length) return { kind: "exhausted" };
  return { kind: "noPath", tips };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}
