// Leaguepedia (lol.fandom.com) Cargo API 客户端。
// 关注点：分页（limit 上限 500）、限速、指数退避（ratelimited / 429 / 5xx）。
// 文档：https://lol.fandom.com/wiki/Help:Cargo

const API = "https://lol.fandom.com/api.php";
const USER_AGENT =
  "rift-pettifogger/0.1 (https://github.com/Skvosis/rift-pettifogger; harukawa.miki@gmail.com)";

/** 请求间隔（毫秒）。Leaguepedia 匿名限速较严，保守取值 + 抖动。 */
const REQUEST_INTERVAL_MS = Number(process.env.CARGO_INTERVAL_MS) || 4000;
const MAX_RETRIES = 10;
const MAX_BACKOFF_MS = 180000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.floor(Math.random() * 1000);

let lastRequestAt = 0;
async function throttle() {
  const wait = REQUEST_INTERVAL_MS + jitter() - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export interface CargoQuery {
  tables: string;
  fields: string;
  where?: string;
  join_on?: string;
  group_by?: string;
  order_by?: string;
  /** 单页条数，最大 500。 */
  limit?: number;
}

/** 一行返回：字段名 -> 字符串值（Cargo 一律返回字符串）。 */
export type CargoRow = Record<string, string>;

interface CargoResponse {
  cargoquery?: { title: CargoRow }[];
  error?: { code: string; info: string };
  warnings?: unknown;
}

function buildUrl(q: CargoQuery, offset: number): string {
  const params = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    tables: q.tables,
    fields: q.fields,
    limit: String(q.limit ?? 500),
    offset: String(offset),
  });
  if (q.where) params.set("where", q.where);
  if (q.join_on) params.set("join_on", q.join_on);
  if (q.group_by) params.set("group_by", q.group_by);
  if (q.order_by) params.set("order_by", q.order_by);
  return `${API}?${params.toString()}`;
}

async function fetchPage(q: CargoQuery, offset: number): Promise<CargoRow[]> {
  const url = buildUrl(q, offset);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    } catch (e) {
      const backoff = Math.min(30000, 1500 * 2 ** attempt);
      console.warn(`  [cargo] 网络错误，${backoff}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${String(e)}`);
      await sleep(backoff);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff =
        retryAfter > 0 ? retryAfter * 1000 : Math.min(MAX_BACKOFF_MS, 2000 * 2 ** attempt) + jitter();
      console.warn(`  [cargo] HTTP ${res.status}，${backoff}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      continue;
    }

    const data = (await res.json()) as CargoResponse;
    if (data.error) {
      if (data.error.code === "ratelimited") {
        const backoff = Math.min(MAX_BACKOFF_MS, 3000 * 2 ** attempt) + jitter();
        console.warn(`  [cargo] 触发限速，${backoff}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }
      throw new Error(`Cargo API 错误 [${data.error.code}]: ${data.error.info}`);
    }
    return (data.cargoquery ?? []).map((x) => x.title);
  }
  throw new Error(`Cargo 查询在 ${MAX_RETRIES} 次重试后仍失败: ${q.tables} ${q.where ?? ""}`);
}

/** 自动翻页拉取一个查询的全部结果。 */
export async function cargoQueryAll(q: CargoQuery): Promise<CargoRow[]> {
  const pageSize = q.limit ?? 500;
  const out: CargoRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage({ ...q, limit: pageSize }, offset);
    out.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

/** 只取一页（用于探查字段名 / 小样本）。 */
export async function cargoQueryOnce(q: CargoQuery): Promise<CargoRow[]> {
  return fetchPage(q, 0);
}
