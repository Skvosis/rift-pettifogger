// 队标解析：Leaguepedia 图片命名惯例 "File:{Page}logo square.png"，
// 通过 MediaWiki API（origin=* 支持 CORS）批量取缩略图 URL。
// localStorage 缓存 30 天；失败/缺图返回 undefined，由 UI 退化为首字母头像。

const LS_KEY = "rp-logos-v1";
const TTL_MS = 30 * 24 * 3600 * 1000;
const API = "https://lol.fandom.com/api.php";

interface CacheEntry {
  url: string | null;
  at: number;
}

let mem: Record<string, CacheEntry> | null = null;

function loadCache(): Record<string, CacheEntry> {
  if (mem) return mem;
  try {
    mem = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    mem = {};
  }
  return mem!;
}

function saveCache() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(mem ?? {}));
  } catch {
    /* 配额满等情况忽略 */
  }
}

const fileTitle = (teamId: string) => `File:${teamId}logo square.png`;

/** 批量解析队标 URL。返回 map：canonical_id -> url（无图则无条目）。 */
export async function resolveLogos(teamIds: string[]): Promise<Map<string, string>> {
  const cache = loadCache();
  const now = Date.now();
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const id of teamIds) {
    const c = cache[id];
    if (c && now - c.at < TTL_MS) {
      if (c.url) out.set(id, c.url);
    } else {
      need.push(id);
    }
  }

  const BATCH = 50;
  for (let i = 0; i < need.length; i += BATCH) {
    const batch = need.slice(i, i + BATCH);
    const titles = batch.map(fileTitle).join("|");
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "48",
      titles,
    });
    try {
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      const found = new Map<string, string>();
      for (const p of Object.values<any>(pages)) {
        const title: string = p?.title ?? "";
        const url: string | undefined = p?.imageinfo?.[0]?.thumburl ?? p?.imageinfo?.[0]?.url;
        if (!title || !url) continue;
        // "File:T1logo square.png" -> "T1"
        const id = title.replace(/^File:/, "").replace(/logo square\.png$/i, "");
        found.set(id, url);
      }
      for (const id of batch) {
        const url = found.get(id) ?? null;
        cache[id] = { url, at: now };
        if (url) out.set(id, url);
      }
    } catch {
      /* 网络失败：不缓存，下次再试 */
    }
  }
  saveCache();
  return out;
}
