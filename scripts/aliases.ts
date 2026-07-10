// 战队规范化：TeamRedirects._pageName（页面移动型改名）+ overrides.json（分页型改名/收购）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cargoQueryAll } from "./cargo.ts";
import type { OverridesFile } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = join(__dirname, "..", "public", "data", "overrides.json");

export function loadOverrides(): OverridesFile {
  try {
    const raw = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"));
    return { merge: raw.merge ?? {}, teams: raw.teams ?? {} };
  } catch {
    return { merge: {}, teams: {} };
  }
}

export interface Resolver {
  /** 原始队名 -> canonical_id。 */
  resolve(name: string): string;
}

/**
 * 针对出现过的原始队名批量查询 TeamRedirects，构建解析器。
 * 解析顺序：overrides.merge[name] > redirect(_pageName) 再叠加 overrides.merge > 原名。
 */
export async function buildResolver(rawNames: Iterable<string>, overrides: OverridesFile): Promise<Resolver> {
  const names = [...new Set([...rawNames].filter(Boolean))];
  const redirect = new Map<string, string>();
  const BATCH = 40;
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const clause = batch.map((n) => `AllName="${n.replace(/"/g, '\\"')}"`).join(" OR ");
    const rows = await cargoQueryAll({
      tables: "TeamRedirects",
      fields: "AllName, _pageName=Page",
      where: clause,
    });
    for (const r of rows) {
      if (r.AllName && r.Page) redirect.set(r.AllName, r.Page);
    }
  }

  const merge = overrides.merge ?? {};
  const resolve = (name: string): string => {
    if (merge[name]) return merge[name];
    const page = redirect.get(name) ?? name;
    return merge[page] ?? page;
  };
  return { resolve };
}
