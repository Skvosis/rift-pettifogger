// 全局过滤器：默认值、URL 编解码（判案结果一条链接即可复现）。
import type { Filters, Scope, Tally } from "./types";

export function defaultFilters(): Filters {
  return {
    start: null,
    end: null, // null = 今天，由引擎按当前时间处理
    scope: "all",
    tally: "series",
    proximityDays: 90,
    strict: false,
  };
}

const SCOPES: Scope[] = ["all", "international", "worlds"];
const TALLIES: Tally[] = ["series", "game"];

/**
 * 把 A、B 与过滤器编码进 URL query，用于分享/复现。
 * 只写非默认值，保持链接简洁。
 */
export function encodeState(a: string | null, b: string | null, f: Filters): string {
  const p = new URLSearchParams();
  if (a) p.set("a", a);
  if (b) p.set("b", b);
  if (f.start) p.set("start", f.start);
  if (f.end) p.set("end", f.end);
  if (f.scope !== "all") p.set("scope", f.scope);
  if (f.tally !== "series") p.set("tally", f.tally);
  if (f.proximityDays !== 90) p.set("prox", String(f.proximityDays));
  if (f.strict) p.set("strict", "1");
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
  f.strict = p.get("strict") === "1";
  f.start = p.get("start");
  f.end = p.get("end");
  return { a: p.get("a"), b: p.get("b"), filters: f };
}

/** 供引擎使用：把 end=null 归一为今天（含当天）。 */
export function resolvedEnd(f: Filters): string {
  if (f.end) return f.end;
  return new Date().toISOString().slice(0, 10);
}
