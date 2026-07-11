// 全局过滤器：默认值、URL 编解码（判案结果一条链接即可复现）。
import type { CrossFormat, Filters, Scope, Tally } from "./types";

/** 引擎链长硬上限（= "不限"）。 */
export const CHAIN_LEN_UNLIMITED = 7;

/** 默认起始时间：过去三个月（滚动）。 */
export function defaultStart(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

export function defaultFilters(): Filters {
  return {
    start: defaultStart(),
    end: null, // null = 今天，由引擎按当前时间处理
    scope: "all",
    tally: "series",
    proximityDays: 90,
    crossFormat: "strict",
    maxChainLen: 3,
  };
}

const SCOPES: Scope[] = ["all", "international", "worlds"];
const TALLIES: Tally[] = ["series", "game"];
const CROSS_FORMATS: CrossFormat[] = ["off", "strict", "loose"];

/**
 * 把 A、B 与过滤器编码进 URL query，用于分享/复现。
 * start 默认值随打开时间滚动，因此始终显式编码（"none" 表示不限），保证链接可复现。
 */
export function encodeState(a: string | null, b: string | null, f: Filters): string {
  const p = new URLSearchParams();
  if (a) p.set("a", a);
  if (b) p.set("b", b);
  p.set("start", f.start ?? "none");
  if (f.end) p.set("end", f.end);
  if (f.scope !== "all") p.set("scope", f.scope);
  if (f.tally !== "series") p.set("tally", f.tally);
  if (f.proximityDays !== 90) p.set("prox", String(f.proximityDays));
  if (f.crossFormat !== "strict") p.set("xf", f.crossFormat);
  if (f.maxChainLen !== 3) p.set("len", String(f.maxChainLen));
  return p.toString();
}

export function decodeState(query: string): { a: string | null; b: string | null; filters: Filters } {
  const p = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const f = defaultFilters();
  const scope = p.get("scope");
  if (scope && SCOPES.includes(scope as Scope)) f.scope = scope as Scope;
  const tally = p.get("tally");
  if (tally && TALLIES.includes(tally as Tally)) f.tally = tally as Tally;
  const prox = Number(p.get("prox"));
  if (Number.isFinite(prox) && prox > 0) f.proximityDays = prox;
  const xf = p.get("xf");
  if (xf && CROSS_FORMATS.includes(xf as CrossFormat)) f.crossFormat = xf as CrossFormat;
  const len = Number(p.get("len"));
  if (Number.isInteger(len) && ((len >= 1 && len <= 5) || len === CHAIN_LEN_UNLIMITED)) {
    f.maxChainLen = len;
  }
  const start = p.get("start");
  if (start === "none") f.start = null;
  else if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) f.start = start;
  const end = p.get("end");
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) f.end = end;
  return { a: p.get("a"), b: p.get("b"), filters: f };
}

/** 供引擎使用：把 end=null 归一为今天（含当天）。 */
export function resolvedEnd(f: Filters): string {
  if (f.end) return f.end;
  return new Date().toISOString().slice(0, 10);
}
